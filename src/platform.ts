import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, Service, Characteristic } from 'homebridge';
import { RainBirdClient } from './RainBirdClient/RainBirdClient';
import {
  PLATFORM_NAME,
  PLUGIN_NAME,
  HoneywellPlatformConfig,
} from './settings';
// import { IrrigationSystem } from './devices/irrigationsystem';

type Device = {
  model: string,
  version: string,
  serialNumber: string,
  zones: number[]
}

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

  version = require('../package.json').version // eslint-disable-line @typescript-eslint/no-var-requires

  public sensorData = [];
  private refreshInterval;
  debugMode!: boolean;
  private rainbird?: RainBirdClient;

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
    } catch (e: any) {
      this.log.error(JSON.stringify(e.message));
      this.log.debug(JSON.stringify(e));
      return;
    }

    this.debugMode = process.argv.includes('-D') || process.argv.includes('--debug');

    this.rainbird = new RainBirdClient(this.config.ipaddress!, this.config.password!, this.log);

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', async () => {
      log.debug('Executed didFinishLaunching callback');
      try {
        this.discoverDevices();
      } catch (e: any) {
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
  private async discoverDevices(): Promise<void> {

    // Get device details
    const respModelAndVersion = await this.rainbird!.getModelAndVersion();
    const respSerialNumber = await this.rainbird!.getSerialNumber();
    const respZones = await this.rainbird!.getAvailableZones();

    const device: Device = {
      model: respModelAndVersion.modelNumber,
      version: respModelAndVersion.version,
      serialNumber: respSerialNumber.serialNumber,
      zones: respZones.zones,
    };

    // Display device details
    this.log.info(`Model: ${device.model} [Version: ${device.version}]`);
    this.log.info(`Serial Number: ${device.serialNumber}`);
    this.log.info(`Zones: ${device.zones}`);

    //await this.createValve(device);
    await this.createIrrigationSystem(device);
  }

  private async createIrrigationSystem(device: Device): Promise<void> {
    const uuid = this.api.hap.uuid.generate(`${device.model}-${device.serialNumber}`);
    const existingAccessory = this.accessories.find((accessory) => accessory.UUID === uuid);

    if (existingAccessory) {
      this.log.info('Configuring existing accessory for', device.model);

      // Irrigation System
      existingAccessory.context.timeEnding = [];
      this.api.updatePlatformAccessories([existingAccessory]);
      this.configureIrrigationService(existingAccessory.getService(this.Service.IrrigationSystem)!);

      // Valves for zones
      for(const service of existingAccessory.services) {
        if (this.Service.Valve.UUID === service.UUID) {
          this.configureValveService(existingAccessory, service);
        }
      }
    } else {
      this.log.info('Creating and configuring accessories for', device.model);

      // Irrigation System
      const irrigationAccessory = new this.api.platformAccessory(device.model, uuid);
      irrigationAccessory.context.timeEnding = [];
      const irrigationSystemService = this.createIrrigationService(irrigationAccessory, device);
      this.configureIrrigationService(irrigationSystemService);

      // Valves for zones
      for(const zone of device.zones) {
        const valveService = this.createValveService(irrigationAccessory, zone);
        irrigationSystemService.addLinkedService(valveService);
        this.configureValveService(irrigationAccessory, valveService);
      }

      // Register
      this.log.debug('Registering platform accessory');
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [irrigationAccessory]);
      this.accessories.push(irrigationAccessory);
    }
  }

  private createIrrigationService(irrigationAccesssory: PlatformAccessory, device: Device): Service {
    this.log.debug('Create Irrigation service');

    irrigationAccesssory.getService(this.Service.AccessoryInformation)!
      .setCharacteristic(this.Characteristic.Name, device.model)
      .setCharacteristic(this.Characteristic.Manufacturer, 'RainBird')
      .setCharacteristic(this.Characteristic.SerialNumber, device.serialNumber)
      .setCharacteristic(this.Characteristic.Model, device.model)
      .setCharacteristic(this.Characteristic.FirmwareRevision, device.version);

    const irrigationSystemService = irrigationAccesssory.addService(this.Service.IrrigationSystem, device.model)
      .setCharacteristic(this.Characteristic.Name, device.model)
      .setCharacteristic(this.Characteristic.Active, this.Characteristic.Active.ACTIVE)
      .setCharacteristic(this.Characteristic.InUse, this.Characteristic.InUse.NOT_IN_USE)
      .setCharacteristic(this.Characteristic.ProgramMode, this.Characteristic.ProgramMode.NO_PROGRAM_SCHEDULED)
      .setCharacteristic(this.Characteristic.RemainingDuration, 0)
      .setCharacteristic(this.Characteristic.StatusFault, this.Characteristic.StatusFault.NO_FAULT);

    return irrigationSystemService;
  }

  private configureIrrigationService(irrigationSystemService: Service): void {
    this.log.debug('Configure Irrigation service');

    irrigationSystemService
      .getCharacteristic(this.Characteristic.Active)
      .onGet(() => {
        return irrigationSystemService.getCharacteristic(this.Characteristic.Active).value;
      })
      .onSet((value) => {
        irrigationSystemService.getCharacteristic(this.Characteristic.Active).updateValue(value);
      });

    irrigationSystemService
      .getCharacteristic(this.Characteristic.ProgramMode)
      .onGet(() => {
        return irrigationSystemService.getCharacteristic(this.Characteristic.ProgramMode).value;
      });

    irrigationSystemService
      .getCharacteristic(this.Characteristic.InUse)
      .onGet(() => {
        return irrigationSystemService.getCharacteristic(this.Characteristic.InUse).value;
      });

    irrigationSystemService
      .getCharacteristic(this.Characteristic.StatusFault)
      .onGet(() => {
        return irrigationSystemService.getCharacteristic(this.Characteristic.StatusFault).value;
      });

    irrigationSystemService
      .getCharacteristic(this.Characteristic.RemainingDuration)
      .onGet(() => {
        return irrigationSystemService.getCharacteristic(this.Characteristic.RemainingDuration).value;
      });
  }

  private createValveService(irrigationAccessory: PlatformAccessory, zone: number): Service {
    this.log.debug('Create Valve service for zone', zone);

    const zoneName = `Zone ${zone}`;
    const valveService = irrigationAccessory.addService(this.Service.Valve, zoneName, zone);
    valveService
      .setCharacteristic(this.Characteristic.Name, zoneName)
      .setCharacteristic(this.Characteristic.Active, this.Characteristic.Active.INACTIVE)
      .setCharacteristic(this.Characteristic.InUse, this.Characteristic.InUse.NOT_IN_USE)
      .setCharacteristic(this.Characteristic.ValveType, this.Characteristic.ValveType.IRRIGATION)
      .setCharacteristic(this.Characteristic.SetDuration, 300)
      .setCharacteristic(this.Characteristic.RemainingDuration, 0)
      .setCharacteristic(this.Characteristic.IsConfigured, this.Characteristic.IsConfigured.CONFIGURED)
      .setCharacteristic(this.Characteristic.ServiceLabelIndex, zone)
      .setCharacteristic(this.Characteristic.StatusFault, this.Characteristic.StatusFault.NO_FAULT);

    return valveService;
  }

  configureValveService(irrigationAccessory: PlatformAccessory, valveService: Service) {
    const zone = valveService.getCharacteristic(this.Characteristic.ServiceLabelIndex).value as number;
    this.log.debug('Configure Valve service for zone', zone);

    valveService
      .getCharacteristic(this.Characteristic.Active)
      .onGet(() => {
        return valveService.getCharacteristic(this.Characteristic.Active).value;
      })
      .onSet(async (value) => {
        // Prepare message for API
        const duration = valveService.getCharacteristic(this.Characteristic.SetDuration).value as number / 60;

        this.log.info(`Zone: ${zone}, Duration: ${duration}, Active: ${value}`);

        if (value === this.Characteristic.Active.ACTIVE) {
          await this.rainbird!.runZone(zone, duration);
        } else {
          await this.rainbird!.stopIrrigation();
        }
      });

    valveService
      .getCharacteristic(this.Characteristic.InUse)
      .onGet(() => {
        return valveService.getCharacteristic(this.Characteristic.InUse).value;
      });

    valveService
      .getCharacteristic(this.Characteristic.IsConfigured)
      .onGet(() => {
        return valveService.getCharacteristic(this.Characteristic.IsConfigured).value;
      })
      .onSet((value) => {
        valveService.getCharacteristic(this.Characteristic.IsConfigured).updateValue(value);
      });

    valveService
      .getCharacteristic(this.Characteristic.StatusFault)
      .onGet(() => {
        return valveService.getCharacteristic(this.Characteristic.StatusFault).value;
      });

    valveService
      .getCharacteristic(this.Characteristic.ValveType)
      .onGet(() => {
        return valveService.getCharacteristic(this.Characteristic.ValveType).value;
      });

    valveService
      .getCharacteristic(this.Characteristic.SetDuration)
      .onGet(() => {
        return valveService.getCharacteristic(this.Characteristic.SetDuration).value;
      })
      .onSet((value) => {
        valveService.getCharacteristic(this.Characteristic.SetDuration).updateValue(value);
      });

    valveService
      .getCharacteristic(this.Characteristic.RemainingDuration)
      .onGet(() => {
        let timeRemaining = Math.max(Math.round((irrigationAccessory.context.timeEnding[zone] - Date.now()) / 1000), 0);
        if (isNaN(timeRemaining)) {
          timeRemaining = 0;
        }
        return timeRemaining;
      });

    irrigationAccessory.context.timeEnding[zone] = 0;
  }

  /*
  private async createValve(device: Device) {
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
        //const getSerialNumber = device.getSerialNumber();
        existingAccessory.context.deviceID = device.getSerialNumber.serialNumber;
        //const getModelAndVersion = device.getModelAndVersion();
        existingAccessory.context.model = device.getModelAndVersion.modelID;
        existingAccessory.context.FirmwareRevision = device.getModelAndVersion.protocolRevisionMajor;
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
  */
}
