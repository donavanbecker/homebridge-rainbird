import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { RainbirdPlatform } from '../platform';
import { RainBirdService } from '../RainBird/RainBirdService';
import { Subject, fromEvent, interval } from 'rxjs';
import { debounceTime, skipWhile, tap } from 'rxjs/operators';
import { DevicesConfig } from '../settings';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class IrrigationSystem {

  private irrigation!: {
    service: Service,
    Active: CharacteristicValue,
    InUse: CharacteristicValue,
  };

  private valves: Map<number, {
    service: Service,
    Active: CharacteristicValue,
    InUse: CharacteristicValue,
    SetDuration: number,
    IsConfigured: CharacteristicValue;
  }> = new Map();

  // Irrigation System Updates
  private irrigationSystemUpdateInProgress!: boolean;
  private doIrrigationSystemUpdate: Subject<number>;

  constructor(
    private readonly platform: RainbirdPlatform,
    private accessory: PlatformAccessory,
    public device: DevicesConfig,
    public rainbird: RainBirdService,
  ) {
    // this is subject we use to track when we need to send changes to Rainbird Client
    this.doIrrigationSystemUpdate = new Subject();
    this.irrigationSystemUpdateInProgress = false;

    if (accessory.context.configured === undefined) {
      accessory.context.configured = {};
    }
    if (accessory.context.duration === undefined) {
      accessory.context.duration = {};
    }

    // Set accessory information
    accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'RainBird')
      .setCharacteristic(this.platform.Characteristic.Model, accessory.context.model ?? rainbird!.model)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, accessory.context.deviceID ?? rainbird!.serialNumber)
      .setCharacteristic(this.platform.Characteristic.FirmwareRevision, accessory.context.FirmwareRevision ?? rainbird!.version)
      .getCharacteristic(this.platform.Characteristic.FirmwareRevision).updateValue(accessory.context.FirmwareRevision);

    // Irrigation Service
    this.platform.debug('Configure Irrigation Service');
    this.irrigation = {
      service: this.accessory.getService(this.platform.Service.IrrigationSystem) ??
        this.accessory.addService(this.platform.Service.IrrigationSystem),
      Active: this.platform.Characteristic.Active.ACTIVE,
      InUse: this.platform.Characteristic.InUse.NOT_IN_USE,
    };

    // Add Irrigation Service's Characteristics
    this.irrigation.service
      .setCharacteristic(this.platform.Characteristic.Name, accessory.displayName)
      .setCharacteristic(this.platform.Characteristic.Active, this.irrigation.Active)
      .setCharacteristic(this.platform.Characteristic.InUse, this.irrigation.InUse)
      .setCharacteristic(this.platform.Characteristic.ProgramMode, this.platform.Characteristic.ProgramMode.NO_PROGRAM_SCHEDULED)
      .setCharacteristic(this.platform.Characteristic.RemainingDuration, 0)
      .setCharacteristic(this.platform.Characteristic.StatusFault, this.platform.Characteristic.StatusFault.NO_FAULT);

    // Create handlers for required characteristics
    this.irrigation.service.getCharacteristic(this.platform.Characteristic.Active)
      .onGet(() => {
        this.rainbird!.refreshStatus();
        return this.irrigation.Active;
      })
      .onSet(this.setActive.bind(this));

    this.irrigation.service.getCharacteristic(this.platform.Characteristic.ProgramMode)
      .onGet(() => {
        return this.irrigation.service.getCharacteristic(this.platform.Characteristic.ProgramMode).value;
      });

    this.irrigation.service.getCharacteristic(this.platform.Characteristic.InUse)
      .onGet(() => {
        this.rainbird!.refreshStatus();
        return this.irrigation.InUse;
      });

    this.irrigation.service.getCharacteristic(this.platform.Characteristic.StatusFault)
      .onGet(() => {
        return this.irrigation.service.getCharacteristic(this.platform.Characteristic.StatusFault).value;
      });

    this.irrigation.service.getCharacteristic(this.platform.Characteristic.RemainingDuration)
      .onGet(() => {
        this.rainbird!.refreshStatus();
        return this.rainbird!.RemainingDuration();
      });

    // Valves for zones
    for (const zone of rainbird!.zones) {
      const name = `Zone ${zone}`;
      this.platform.device(`Load Valve Service for ${name}`);
      this.valves.set(zone, {
        service: this.accessory.getService(name) ??
          this.accessory.addService(this.platform.Service.Valve, name, zone),
        Active: this.platform.Characteristic.Active.INACTIVE as CharacteristicValue,
        InUse: this.platform.Characteristic.InUse.NOT_IN_USE as CharacteristicValue,
        SetDuration: this.accessory.context.duration[zone] ?? 300,
        IsConfigured: this.accessory.context.configured[zone] ?? this.platform.Characteristic.IsConfigured.CONFIGURED,
      });

      // Add Valve Service's Characteristics
      this.valves.get(zone)!.service
        .setCharacteristic(this.platform.Characteristic.Name, name)
        .setCharacteristic(this.platform.Characteristic.Active, this.valves.get(zone)!.Active)
        .setCharacteristic(this.platform.Characteristic.InUse, this.valves.get(zone)!.InUse)
        .setCharacteristic(this.platform.Characteristic.ValveType, this.platform.Characteristic.ValveType.IRRIGATION)
        .setCharacteristic(this.platform.Characteristic.SetDuration, this.valves.get(zone)!.SetDuration)
        .setCharacteristic(this.platform.Characteristic.RemainingDuration, 0)
        .setCharacteristic(this.platform.Characteristic.IsConfigured, this.valves.get(zone)!.IsConfigured)
        .setCharacteristic(this.platform.Characteristic.ServiceLabelIndex, zone)
        .setCharacteristic(this.platform.Characteristic.StatusFault, this.platform.Characteristic.StatusFault.NO_FAULT);

      this.irrigation.service.addLinkedService(this.valves.get(zone)!.service);

      // Create handlers for required Valve characteristics
      this.platform.device(`Configure Characteristics for ${name}`);

      this.valves.get(zone)!.service
        .getCharacteristic(this.platform.Characteristic.Active)
        .onGet(() => {
          this.rainbird!.refreshStatus();
          return this.valves.get(zone)!.Active;
        })
        .onSet(this.setValveActive.bind(this, zone));

      this.valves.get(zone)!.service
        .getCharacteristic(this.platform.Characteristic.InUse)
        .onGet(() => {
          this.rainbird!.refreshStatus();
          return this.valves.get(zone)!.InUse;
        });

      this.valves.get(zone)!.service
        .getCharacteristic(this.platform.Characteristic.IsConfigured)
        .onGet(() => {
          return this.valves.get(zone)!.service.getCharacteristic(this.platform.Characteristic.IsConfigured).value;
        })
        .onSet(this.setValveIsConfigured.bind(this, zone));

      this.valves.get(zone)!.service
        .getCharacteristic(this.platform.Characteristic.StatusFault)
        .onGet(() => {
          return this.valves.get(zone)!.service.getCharacteristic(this.platform.Characteristic.StatusFault).value;
        });

      this.valves.get(zone)!.service
        .getCharacteristic(this.platform.Characteristic.ValveType)
        .onGet(() => {
          return this.valves.get(zone)!.service.getCharacteristic(this.platform.Characteristic.ValveType).value;
        });

      this.valves.get(zone)!.service
        .getCharacteristic(this.platform.Characteristic.SetDuration)
        .onGet(() => {
          return Number(this.valves.get(zone)!.SetDuration);
        })
        .onSet(this.setValveSetDuration.bind(this, zone));

      this.valves.get(zone)!.service
        .getCharacteristic(this.platform.Characteristic.RemainingDuration)
        .onGet(() => {
          this.rainbird!.refreshStatus();
          return this.rainbird!.RemainingDuration(zone);
        });
    }

    // Initial Device Parse
    this.parseStatus();
    this.updateHomeKitCharacteristics();

    // Device Parse when status event emitted
    fromEvent(rainbird!, 'status').subscribe({
      next: () => {
        this.parseStatus();
        this.updateHomeKitCharacteristics();
      },
    });

    // Start an update interval
    interval(this.platform.config.options!.refreshRate! * 1000)
      .pipe(skipWhile(() => this.irrigationSystemUpdateInProgress))
      .subscribe(() => {
        this.rainbird!.refreshStatus();
      });

    this.doIrrigationSystemUpdate
      .pipe(
        tap(() => {
          this.irrigationSystemUpdateInProgress = true;
        }),
        debounceTime(this.platform.config.options!.pushRate! * 1000),
      )
      .subscribe(async (zone: number) => {
        try {
          await this.pushChanges(zone);
        } catch (e: any) {
          this.platform.log.error(e);
          this.platform.debug(`Irrigation System ${this.accessory.displayName} - ${JSON.stringify(e)}`);
        }
        this.irrigationSystemUpdateInProgress = false;
      });
  }

  /**
   * Parse the device status from the RainbirdClient
   */
  parseStatus() {
    // Irrigation System
    this.irrigation.Active = this.rainbird!.isActive()
      ? this.platform.Characteristic.Active.ACTIVE
      : this.platform.Characteristic.Active.INACTIVE;

    this.irrigation.InUse = this.rainbird!.isInUse()
      ? this.platform.Characteristic.InUse.IN_USE
      : this.platform.Characteristic.InUse.NOT_IN_USE;
    this.platform.debug(
      `Irrigation System: ${this.accessory.displayName}, Active: ${this.irrigation.Active}, InUse: ${this.irrigation.InUse}`);

    // Valves
    for (const [zone, valve] of this.valves.entries()) {
      valve.Active = this.rainbird!.isActive(zone)
        ? this.platform.Characteristic.Active.ACTIVE
        : this.platform.Characteristic.Active.INACTIVE;

      valve.InUse = this.rainbird!.isInUse(zone)
        ? this.platform.Characteristic.InUse.IN_USE
        : this.platform.Characteristic.InUse.NOT_IN_USE;

      this.platform.debug(`Valve: ${zone}, Active: ${valve.Active}, InUse: ${valve.InUse}`);
    }
  }

  /**
   * Updates the status for each of the HomeKit Characteristics
   */
  updateHomeKitCharacteristics() {
    // Irrigation System
    if (this.irrigation.Active === undefined) {
      this.platform.debug(`Irrigation ${this.accessory.displayName} Active: ${this.irrigation.Active}`);
    } else {
      this.irrigation.service.updateCharacteristic(this.platform.Characteristic.Active, this.irrigation.Active);
      this.platform.device(`Irrigation ${this.accessory.displayName} updateCharacteristic Active: ${this.irrigation.Active}`);
    }
    if (this.irrigation.InUse === undefined) {
      this.platform.debug(`Irrigation ${this.accessory.displayName} InUse: ${this.irrigation.InUse}`);
    } else {
      this.irrigation.service.updateCharacteristic(this.platform.Characteristic.InUse, this.irrigation.InUse);
      this.platform.device(`Irrigation ${this.accessory.displayName} updateCharacteristic InUse: ${this.irrigation.InUse}`);
    }
    if (this.rainbird!.RemainingDuration() === undefined) {
      this.platform.debug(`Irrigation ${this.accessory.displayName} RemainingDuration: ${this.rainbird!.RemainingDuration()}`);
    } else {
      this.irrigation.service.updateCharacteristic(this.platform.Characteristic.RemainingDuration, this.rainbird!.RemainingDuration());
      this.platform.device(`Irrigation ${this.accessory.displayName} updateCharacteristic RemainingDuration: ${this.rainbird!.RemainingDuration()}`);
    }

    // Valves
    for (const [zone, valve] of this.valves.entries()) {
      if (valve.Active === undefined) {
        this.platform.debug(`Valve ${this.accessory.displayName} Active: ${valve.Active}`);
      } else {
        valve.service.updateCharacteristic(this.platform.Characteristic.Active, valve.Active);
        this.platform.device(`Valve ${this.accessory.displayName} updateCharacteristic Active: ${valve.Active}`);
      }
      if (valve.InUse === undefined) {
        this.platform.debug(`Valve ${this.accessory.displayName} InUse: ${valve.InUse}`);
      } else {
        valve.service.updateCharacteristic(this.platform.Characteristic.InUse, valve.InUse);
        this.platform.device(`Valve ${this.accessory.displayName} updateCharacteristic InUse: ${valve.InUse}`);
      }
      if (valve.SetDuration === undefined) {
        this.platform.debug(`Valve ${this.accessory.displayName} SetDuration: ${valve.InUse}`);
      } else {
        valve.service.updateCharacteristic(this.platform.Characteristic.SetDuration, valve.SetDuration);
        this.platform.device(`Valve ${this.accessory.displayName} updateCharacteristic SetDuration: ${valve.SetDuration}`);
      }
      if (valve.IsConfigured === undefined) {
        this.platform.debug(`Valve ${this.accessory.displayName} IsConfigured: ${valve.IsConfigured}`);
      } else {
        valve.service.updateCharacteristic(this.platform.Characteristic.IsConfigured, valve.IsConfigured);
        this.platform.device(`Valve ${this.accessory.displayName} updateCharacteristic IsConfigured: ${valve.IsConfigured}`);
      }
      if (this.rainbird!.RemainingDuration(zone) === undefined) {
        this.platform.debug(`Valve ${this.accessory.displayName} RemainingDuration: ${this.rainbird!.RemainingDuration(zone)}`);
      } else {
        valve.service.updateCharacteristic(this.platform.Characteristic.RemainingDuration, this.rainbird!.RemainingDuration(zone));
        this.platform.device(`Valve ${this.accessory.displayName} updateCharacteristic RemainingDuration: ${this.rainbird!.RemainingDuration(zone)}`);
      }
    }
  }

  /**
   * Pushes the requested changes to the RainbirdClient
   */
  async pushChanges(zone: number): Promise<void> {
    if (this.valves.get(zone)!.Active === this.platform.Characteristic.Active.ACTIVE) {
      this.rainbird!.activateZone(zone, this.valves.get(zone)!.SetDuration);
    } else {
      await this.rainbird!.deactivateZone(zone);
    }

    this.platform.device(`Irrigation System ${this.accessory.displayName}, pushChanges: [Valve: ${zone},`
      + ` Active: ${this.valves.get(zone)!.Active}, SetDuration: ${this.valves.get(zone)!.SetDuration}]`);
  }

  private setActive(value: CharacteristicValue) {
    this.platform.device(`Irrigation System ${this.accessory.displayName}, Set Active: ${value}`);
    this.irrigation.Active = value;
  }

  private setValveActive(zone: number, value: CharacteristicValue) {
    this.platform.device(`Irrigation System ${this.accessory.displayName}, Valve: ${zone}, Set Active: ${value}`);
    this.valves.get(zone)!.Active = value;
    this.doIrrigationSystemUpdate.next(zone);
  }

  private setValveIsConfigured(zone: number, value: CharacteristicValue) {
    this.platform.device(`Irrigation System ${this.accessory.displayName}, Valve: ${zone}, Set IsConfigured: ${value}`);
    this.valves.get(zone)!.IsConfigured = value;
    this.accessory.context.configured[zone] = value;
    this.rainbird!.enableZone(zone, value === this.platform.Characteristic.IsConfigured.CONFIGURED);
  }

  private setValveSetDuration(zone: number, value: CharacteristicValue) {
    this.platform.device(`Irrigation System ${this.accessory.displayName}, Valve: ${zone}, Set SetDuration: ${value}`);
    this.valves.get(zone)!.SetDuration = value as number;
    this.accessory.context.duration[zone] = value;
  }

  refreshRate(device: device & devicesConfig) {
    if (device.refreshRate) {
      this.deviceRefreshRate = this.accessory.context.refreshRate = device.refreshRate;
      this.debugLog(`Thermostat: ${this.accessory.displayName} Using Device Config refreshRate: ${this.deviceRefreshRate}`);
    } else if (this.platform.config.options!.refreshRate) {
      this.deviceRefreshRate = this.accessory.context.refreshRate = this.platform.config.options!.refreshRate;
      this.debugLog(`Thermostat: ${this.accessory.displayName} Using Platform Config refreshRate: ${this.deviceRefreshRate}`);
    }
  }

  logs(device: device & devicesConfig) {
    if (this.platform.debugMode) {
      this.deviceLogging = this.accessory.context.logging = 'debugMode';
      this.debugLog(`Thermostat: ${this.accessory.displayName} Using Debug Mode Logging: ${this.deviceLogging}`);
    } else if (device.logging) {
      this.deviceLogging = this.accessory.context.logging = device.logging;
      this.debugLog(`Thermostat: ${this.accessory.displayName} Using Device Config Logging: ${this.deviceLogging}`);
    } else if (this.platform.config.options?.logging) {
      this.deviceLogging = this.accessory.context.logging = this.platform.config.options?.logging;
      this.debugLog(`Thermostat: ${this.accessory.displayName} Using Platform Config Logging: ${this.deviceLogging}`);
    } else {
      this.deviceLogging = this.accessory.context.logging = 'standard';
      this.debugLog(`Thermostat: ${this.accessory.displayName} Logging Not Set, Using: ${this.deviceLogging}`);
    }
  }

  /**
 * Logging for Device
 */
  infoLog(...log: any[]) {
    if (this.enablingDeviceLogging()) {
      this.platform.log.info(String(...log));
    }
  }

  warnLog(...log: any[]) {
    if (this.enablingDeviceLogging()) {
      this.platform.log.warn(String(...log));
    }
  }

  errorLog(...log: any[]) {
    if (this.enablingDeviceLogging()) {
      this.platform.log.error(String(...log));
    }
  }

  debugLog(...log: any[]) {
    if (this.enablingDeviceLogging()) {
      if (this.deviceLogging === 'debug') {
        this.platform.log.info('[DEBUG]', String(...log));
      } else {
        this.platform.log.debug(String(...log));
      }
    }
  }

  enablingDeviceLogging(): boolean {
    return this.deviceLogging.includes('debug') || this.deviceLogging === 'standard';
  }
}
