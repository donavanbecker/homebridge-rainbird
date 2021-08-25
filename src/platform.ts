import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, Service, Characteristic } from 'homebridge';
import RainBirdClass from 'node-rainbird';
import {
  PLATFORM_NAME,
  PLUGIN_NAME,
  HoneywellPlatformConfig,
} from './settings';
import { IrrigationSystem } from './devices/irrigationsystem';

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class RainbirdPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

  // this is used to track restored cached accessories
  public readonly accessories: PlatformAccessory[] = [];

  rainbird = new RainBirdClass();
  version = require('../package.json').version // eslint-disable-line @typescript-eslint/no-var-requires

  public sensorData = [];
  private refreshInterval;
  debugMode!: boolean;
  rainbirdDebugMode!: boolean;

  constructor(public readonly log: Logger, public readonly config: HoneywellPlatformConfig, public readonly api: API) {
    this.log.debug('Finished initializing platform:', this.config.name);
    // only load if configured
    if (!this.config) {
      return;
    }

    // HOOBS notice
    if (__dirname.includes('hoobs')) {
      this.log.warn('This plugin has not been tested under HOOBS, it is highly recommended that ' +
        'you switch to Homebridge: https://git.io/Jtxb0');
    }

    // verify the config
    try {
      this.verifyConfig();
      this.log.debug('Config OK');
    } catch (e) {
      this.log.error(JSON.stringify(e.message));
      this.log.debug(JSON.stringify(e));
      return;
    }

    this.debugMode = process.argv.includes('-D') || process.argv.includes('--debug');

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', async () => {
      log.debug('Executed didFinishLaunching callback');
      try {
        this.discoverDevices();
      } catch (e) {
        this.log.error('Failed to Discover Devices,', JSON.stringify(e.message));
        this.log.debug(JSON.stringify(e));
      }
    });
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);

    // add the restored accessory to the accessories cache so we can track if it has already been registered
    this.accessories.push(accessory);
  }

  /**
   * Verify the config passed to the plugin is valid
   */
  verifyConfig() {
    /**
     * Hidden Device Discovery Option
     * This will disable adding any device and will just output info.
     */
    this.config.devicediscovery;
    this.config.disablePlugin;

    this.config.options = this.config.options || {};

    // Hide Devices by DeviceID
    this.config.options.hide_device = this.config.options.hide_device || [];

    if (this.config.options!.refreshRate! < 120) {
      throw new Error('Refresh Rate must be above 120 (2 minutes).');
    }

    if (this.config.disablePlugin) {
      this.log.error('Plugin is disabled.');
    }

    if (!this.config.options.refreshRate && !this.config.disablePlugin) {
      // default 900 seconds (15 minutes)
      this.config.options!.refreshRate! = 900;
      if (this.debugMode) {
        this.log.warn('Using Default Refresh Rate.');
      }
    }

    if (!this.config.options.pushRate && !this.config.disablePlugin) {
      // default 100 milliseconds
      this.config.options!.pushRate! = 0.1;
      if (this.debugMode) {
        this.log.warn('Using Default Push Rate.');
      }

    }

    if (!this.config.password) {
      throw new Error('Missing Password');
    }
    if (!this.config.ipaddress) {
      throw new Error('Missing IP Address');
    }
  }

  /**
   * This method is used to discover the your location and devices.
   * Accessories are registered by either their DeviceClass, DeviceModel, or DeviceID
   */
  private async discoverDevices() {
    if (this.debugMode || this.config.options!.rbDebug) {
      this.rainbirdDebugMode = true;
    } else {
      this.rainbirdDebugMode = false;
    }

    const rainbird = new RainBirdClass(this.config.ipaddress, this.config.password, this.rainbirdDebugMode);
    const device = rainbird;

    //setDebug
    //Enables verbose console logging
    rainbird.setDebug(this.rainbirdDebugMode);

    //getModelAndVersion
    //Returns the Rainbird mode and firmware version
    this.log.info(JSON.stringify(rainbird.getModelAndVersion()));

    //getSerialNumber
    //Returns the controller's serial number. For ESP-RZXe this is always 0000000000000000
    this.log.info(JSON.stringify(rainbird.getSerialNumber()));

    this.log.info(JSON.stringify(device));
    await this.createValve(device);
  }

  private async createValve(device) {
    const uuid = this.api.hap.uuid.generate(`${device.name}-${device.deviceID}-${device.deviceModel}`);

    // see if an accessory with the same uuid has already been registered and restored from
    // the cached devices we stored in the `configureAccessory` method above
    const existingAccessory = this.accessories.find((accessory) => accessory.UUID === uuid);

    if (existingAccessory) {
      // the accessory already exists
      if (
        !this.config.options?.hide_device.includes(device.deviceID) &&
        !this.config.disablePlugin
      ) {
        this.log.info(
          'Restoring existing accessory from cache:',
          existingAccessory.displayName,
          'DeviceID:',
          device.deviceID,
        );

        // if you need to update the accessory.context then you should run `api.updatePlatformAccessories`. eg.:
        existingAccessory.context.device = device;
        const getSerialNumber = device.getSerialNumber();
        existingAccessory.context.deviceID = getSerialNumber.serialNumber;
        const getModelAndVersion = device.getModelAndVersion();
        existingAccessory.context.model = getModelAndVersion.modelID;
        existingAccessory.context.FirmwareRevision = getModelAndVersion.protocolRevisionMajor;
        this.api.updatePlatformAccessories([existingAccessory]);
        // create the accessory handler for the restored accessory
        // this is imported from `platformAccessory.ts`
        new IrrigationSystem(this, existingAccessory, device);
        this.log.debug(`Irrigation UDID: ${device.name}-${device.deviceID}-${device.deviceModel}`);
      } else {
        this.unregisterPlatformAccessories(existingAccessory);
      }
    } else if (
      !this.config.options?.hide_device.includes(device.deviceID) &&
      !this.config.disablePlugin
    ) {
      // the accessory does not yet exist, so we need to create it
      this.log.info(
        'Adding new accessory:',
        device.name,
        'Valve',
        device.deviceModel,
        device.deviceType,
        'DeviceID:',
        device.deviceID,
      );

      // create a new accessory
      const accessory = new this.api.platformAccessory(`${device.name} ${device.deviceType}`, uuid);

      // store a copy of the device object in the `accessory.context`
      // the `context` property can be used to store any data about the accessory you may need
      accessory.context.device = device;
      const getSerialNumber = device.getSerialNumber();
      accessory.context.deviceID = getSerialNumber.serialNumber;
      const getModelAndVersion = device.getModelAndVersion();
      accessory.context.model = getModelAndVersion.modelID;
      accessory.context.FirmwareRevision = getModelAndVersion.protocolRevisionMajor;
      // create the accessory handler for the newly create accessory
      // this is imported from `platformAccessory.ts`
      new IrrigationSystem(this, accessory, device);
      this.log.debug(`Irrigation UDID: ${device.name}-${device.deviceID}-${device.deviceModel}`);

      // link the accessory to your platform
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      this.accessories.push(accessory);
    } else {
      if (this.config.devicediscovery) {
        this.log.error(
          'Unable to Register new device:',
          device.name,
          'Irrigation',
          device.deviceModel,
          device.deviceType,
          'DeviceID:',
          device.deviceID,
        );
        this.log.error('Check Config to see if DeviceID is being Hidden.');
      }
    }
  }

  public unregisterPlatformAccessories(existingAccessory: PlatformAccessory) {
    // remove platform accessories when no longer present
    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
    this.log.warn('Removing existing accessory from cache:', existingAccessory.displayName);
  }

}
