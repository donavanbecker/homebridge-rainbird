import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, Service, Characteristic } from 'homebridge';
import { RainBirdClient } from './RainBirdClient/RainBirdClient';
import {
  PLATFORM_NAME,
  PLUGIN_NAME,
  HoneywellPlatformConfig,
  DevicesConfig,
} from './settings';
import { Irrigation } from './devices/irrigation';

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
    } catch (e: any) {
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
    this.config.disablePlugin;

    if (this.config.devices) {
      for (const device of this.config.devices!) {
        if (!device.ipaddress) {
          throw new Error('The devices config section is missing the "IP Address" in the config, and will be skipped.');
        }
        if (!device.password) {
          throw new Error('The devices config section is missing the "Password" in the config, and will be skipped.');
        }
      }
    } else {
      throw new Error('The devices config section is missing from the config. This device will be skipped.');
    }

    this.config.options = this.config.options || {};

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
  }

  /**
   * This method is used to discover the your location and devices.
   */
  private async discoverDevices() {
    for (const device of this.config.devices!) {
      const rainbird = new RainBirdClient(device.ipaddress!, device.password!, this.log);
      // Initiliase device details
      await rainbird!.init();
      rainbird!.on('status', this.updateValues.bind(this, rainbird));

      // Display device details
      this.log.info(`Model: ${rainbird!.model} [Version: ${rainbird!.version}]`);
      this.log.info(`Serial Number: ${rainbird!.serialNumber}`);
      this.log.info(`Zones: ${rainbird!.zones}`);
      await this.createIrrigation(device, rainbird);
    }
  }

  private async createIrrigation(device: DevicesConfig, rainbird:RainBirdClient) {
    const uuid = this.api.hap.uuid.generate(`${rainbird!.model}-${rainbird!.serialNumber}`);
    // see if an accessory with the same uuid has already been registered and restored from
    // the cached devices we stored in the `configureAccessory` method above
    const existingAccessory = this.accessories.find((accessory) => accessory.UUID === uuid);

    if (existingAccessory) {
      // the accessory already exists
      if (!this.config.disablePlugin) {
        this.log.info(
          'Restoring existing accessory from cache: %s',
          existingAccessory.displayName,
        );

        // if you need to update the accessory.context then you should run `api.updatePlatformAccessories`. eg.:
        existingAccessory.context.device = device;
        existingAccessory.context.deviceID = rainbird!.serialNumber;
        existingAccessory.context.model = rainbird!.model;
        existingAccessory.context.FirmwareRevision = rainbird!.version;
        this.api.updatePlatformAccessories([existingAccessory]);
        // create the accessory handler for the restored accessory
        // this is imported from `platformAccessory.ts`
        new Irrigation(this, existingAccessory, device, rainbird);
        this.log.debug(`Irrigation UDID: ${rainbird!.model}-${rainbird!.serialNumber}`);

      } else {
        this.unregisterPlatformAccessories(existingAccessory);
      }
    } else if (!this.config.disablePlugin) {
      // the accessory does not yet exist, so we need to create it
      this.log.info(
        'Adding new accessory: %s',
        rainbird!.model,
      );

      // create a new accessory
      const accessory = new this.api.platformAccessory(rainbird!.model, uuid);

      // store a copy of the device object in the `accessory.context`
      // the `context` property can be used to store any data about the accessory you may need
      accessory.context.device = device;
      accessory.context.deviceID = rainbird!.serialNumber;
      accessory.context.model = rainbird!.model;
      accessory.context.FirmwareRevision = rainbird!.version;
      // create the accessory handler for the newly create accessory
      // this is imported from `platformAccessory.ts`
      new Irrigation(this, accessory, device, rainbird);
      this.log.debug(`Irrigation UDID: ${rainbird!.model}-${rainbird!.serialNumber}`);

      // link the accessory to your platform
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      this.accessories.push(accessory);
    } else if (this.debugMode) {
      this.log.error(
        'Unable to Register new device: %s',
        rainbird!.model,
      );
    }
  }

  public unregisterPlatformAccessories(existingAccessory: PlatformAccessory) {
    // remove platform accessories when no longer present
    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
    this.log.warn('Removing existing accessory from cache:', existingAccessory.displayName);
  }

  public updateValues(rainbird: RainBirdClient): void {
    this.log.debug('Updating values');

    for (const accessory of this.accessories) {
      for (const service of accessory.services) {
        if (service instanceof this.Service.IrrigationSystem) {
          service
            .getCharacteristic(this.Characteristic.Active)
            .updateValue(rainbird!.isActive() ? this.Characteristic.Active.ACTIVE : this.Characteristic.Active.INACTIVE);
          service
            .getCharacteristic(this.Characteristic.InUse)
            .updateValue(rainbird!.isInUse() ? this.Characteristic.InUse.IN_USE : this.Characteristic.InUse.NOT_IN_USE);
          service
            .getCharacteristic(this.Characteristic.RemainingDuration)
            .updateValue(rainbird!.durationRemaining());
        } else if (service instanceof this.Service.Valve) {
          const zone = service.getCharacteristic(this.Characteristic.ServiceLabelIndex).value as number;
          service
            .getCharacteristic(this.Characteristic.Active)
            .updateValue(rainbird!.isActive(zone) ? this.Characteristic.Active.ACTIVE : this.Characteristic.Active.INACTIVE);
          service
            .getCharacteristic(this.Characteristic.InUse)
            .updateValue(rainbird!.isInUse(zone) ? this.Characteristic.InUse.IN_USE : this.Characteristic.InUse.NOT_IN_USE);
          service
            .getCharacteristic(this.Characteristic.RemainingDuration)
            .updateValue(rainbird!.durationRemaining(zone));
        }
      }
    }
  }

  /*
     private async discoverDevices(): Promise<void> {

      // Initiliase device details
      await this.rainbird!.init();
      this.rainbird!.on('status', this.updateValues.bind(this));

      // Display device details
      this.log.info(`Model: ${this.rainbird!.model} [Version: ${this.rainbird!.version}]`);
      this.log.info(`Serial Number: ${this.rainbird!.serialNumber}`);
      this.log.info(`Zones: ${this.rainbird!.zones}`);

      await this.createIrrigationSystem();
    }

    private async createIrrigationSystem(): Promise<void> {
      const uuid = this.api.hap.uuid.generate(`${this.rainbird!.model}-${this.rainbird!.serialNumber}`);
      const existingAccessory = this.accessories.find((accessory) => accessory.UUID === uuid);

      if (existingAccessory) {
        this.log.info('Configuring existing accessory for', this.rainbird!.model);

        // Irrigation System
        this.api.updatePlatformAccessories([existingAccessory]);
        this.configureIrrigationService(existingAccessory.getService(this.Service.IrrigationSystem)!);

        // Valves for zones
        for(const service of existingAccessory.services) {
          if (this.Service.Valve.UUID === service.UUID) {
            this.configureValveService(existingAccessory, service);
          }
        }
      } else {
        this.log.info('Creating and configuring accessories for', this.rainbird!.model);

        // Irrigation System
        const irrigationAccessory = new this.api.platformAccessory(this.rainbird!.model, uuid);
        //irrigationAccessory.context.timeEnding = [];
        const irrigationSystemService = this.createIrrigationService(irrigationAccessory);
        this.configureIrrigationService(irrigationSystemService);

        // Valves for zones
        for(const zone of this.rainbird!.zones) {
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

    private createIrrigationService(irrigationAccesssory: PlatformAccessory): Service {
      this.log.debug('Create Irrigation service');

      irrigationAccesssory.getService(this.Service.AccessoryInformation)!
        .setCharacteristic(this.Characteristic.Name, this.rainbird!.model)
        .setCharacteristic(this.Characteristic.Manufacturer, 'RainBird')
        .setCharacteristic(this.Characteristic.SerialNumber, this.rainbird!.serialNumber)
        .setCharacteristic(this.Characteristic.Model, this.rainbird!.model)
        .setCharacteristic(this.Characteristic.FirmwareRevision, this.rainbird!.version);

      const irrigationSystemService = irrigationAccesssory.addService(this.Service.IrrigationSystem, this.rainbird!.model)
        .setCharacteristic(this.Characteristic.Name, this.rainbird!.model)
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
          return this.rainbird!.isActive()
            ? this.Characteristic.Active.ACTIVE
            : this.Characteristic.Active.INACTIVE;
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
          return this.rainbird!.isInUse()
            ? this.Characteristic.InUse.IN_USE
            : this.Characteristic.InUse.NOT_IN_USE;
        });

      irrigationSystemService
        .getCharacteristic(this.Characteristic.StatusFault)
        .onGet(() => {
          return irrigationSystemService.getCharacteristic(this.Characteristic.StatusFault).value;
        });

      irrigationSystemService
        .getCharacteristic(this.Characteristic.RemainingDuration)
        .onGet(() => {
          return this.rainbird!.durationRemaining();
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
          return this.rainbird!.isActive(zone)
            ? this.Characteristic.Active.ACTIVE
            : this.Characteristic.Active.INACTIVE;
        })
        .onSet(async (value) => {
          if (value === this.Characteristic.Active.ACTIVE) {
            this.rainbird!.activateZone(zone);
          } else {
            await this.rainbird!.deactivateZone(zone);
          }
        });

      valveService
        .getCharacteristic(this.Characteristic.InUse)
        .onGet(() => {
          return this.rainbird!.isInUse(zone)
            ? this.Characteristic.InUse.IN_USE
            : this.Characteristic.InUse.NOT_IN_USE;
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
          return this.rainbird!.duration(zone);
        })
        .onSet((value) => {
          this.rainbird!.setDuration(zone, value as number);
        });

      valveService
        .getCharacteristic(this.Characteristic.RemainingDuration)
        .onGet(() => {
          return this.rainbird!.durationRemaining(zone);
        });
    }

    private updateValues(): void {
      this.log.debug('Updating values');

      for (const accessory of this.accessories) {
        for (const service of accessory.services) {
          if (service instanceof this.Service.IrrigationSystem) {
            service
              .getCharacteristic(this.Characteristic.Active)
              .updateValue(this.rainbird!.isActive() ? this.Characteristic.Active.ACTIVE : this.Characteristic.Active.INACTIVE);
            service
              .getCharacteristic(this.Characteristic.InUse)
              .updateValue(this.rainbird!.isInUse() ? this.Characteristic.InUse.IN_USE : this.Characteristic.InUse.NOT_IN_USE);
            service
              .getCharacteristic(this.Characteristic.RemainingDuration)
              .updateValue(this.rainbird!.durationRemaining());
          } else if (service instanceof this.Service.Valve) {
            const zone = service.getCharacteristic(this.Characteristic.ServiceLabelIndex).value as number;
            service
              .getCharacteristic(this.Characteristic.Active)
              .updateValue(this.rainbird!.isActive(zone) ? this.Characteristic.Active.ACTIVE : this.Characteristic.Active.INACTIVE);
            service
              .getCharacteristic(this.Characteristic.InUse)
              .updateValue(this.rainbird!.isInUse(zone) ? this.Characteristic.InUse.IN_USE : this.Characteristic.InUse.NOT_IN_USE);
            service
              .getCharacteristic(this.Characteristic.RemainingDuration)
              .updateValue(this.rainbird!.durationRemaining(zone));
          }
        }
      }
    }*/
}
