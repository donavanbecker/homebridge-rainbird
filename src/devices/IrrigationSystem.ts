import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { RainbirdPlatform } from '../platform';
import { RainBirdService } from '../RainBird/RainBirdService';
import { Subject, fromEvent, interval } from 'rxjs';
import { debounceTime, skipWhile, tap } from 'rxjs/operators';
import { DevicesConfig } from '../settings';
import { DeviceBase } from './DeviceBase';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class IrrigationSystem extends DeviceBase {
  private irrigation!: {
    service: Service;
    Active: CharacteristicValue;
    InUse: CharacteristicValue;
  };

  private valves: Map<
    number,
    {
      service: Service;
      Active: CharacteristicValue;
      InUse: CharacteristicValue;
    }
  > = new Map();

  // Irrigation System Updates
  private irrigationSystemUpdateInProgress!: boolean;
  private doIrrigationSystemUpdate: Subject<number>;

  constructor(
    readonly platform: RainbirdPlatform,
    accessory: PlatformAccessory,
    device: DevicesConfig,
    rainbird: RainBirdService,
  ) {
    super(platform, accessory, device, rainbird);
    this.config(device);

    // this is subject we use to track when we need to send changes to Rainbird Client
    this.doIrrigationSystemUpdate = new Subject();
    this.irrigationSystemUpdateInProgress = false;

    if (accessory.context.configured === undefined) {
      accessory.context.configured = {};
    }
    if (accessory.context.duration === undefined) {
      accessory.context.duration = {};
    }

    // Irrigation Service
    this.debugLog('Configure Irrigation Service');
    this.irrigation = {
      service: this.accessory.getService(this.platform.Service.IrrigationSystem) ?? this.accessory.addService(this.platform.Service.IrrigationSystem),
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
    this.irrigation.service
      .getCharacteristic(this.platform.Characteristic.Active)
      .onGet(() => {
        this.rainbird!.refreshStatus();
        return this.irrigation.Active;
      })
      .onSet(this.setActive.bind(this));

    this.irrigation.service.getCharacteristic(this.platform.Characteristic.ProgramMode).onGet(() => {
      return this.irrigation.service.getCharacteristic(this.platform.Characteristic.ProgramMode).value;
    });

    this.irrigation.service.getCharacteristic(this.platform.Characteristic.InUse).onGet(() => {
      this.rainbird!.refreshStatus();
      return this.irrigation.InUse;
    });

    this.irrigation.service.getCharacteristic(this.platform.Characteristic.StatusFault).onGet(() => {
      return this.irrigation.service.getCharacteristic(this.platform.Characteristic.StatusFault).value;
    });

    this.irrigation.service.getCharacteristic(this.platform.Characteristic.RemainingDuration).onGet(() => {
      this.rainbird!.refreshStatus();
      return this.rainbird!.RemainingDuration();
    });

    // Valves for zones
    for (const zone of rainbird!.zones) {
      const name = `Zone ${zone}`;
      this.debugLog(`Load Valve Service for ${name}`);

      if (this.accessory.context.configured[zone] === undefined) {
        this.accessory.context.configured[zone] = this.platform.Characteristic.IsConfigured.CONFIGURED;
      }
      if (this.accessory.context.duration[zone] === undefined) {
        this.accessory.context.duration[zone] = 300;
      }

      this.valves.set(zone, {
        service: this.accessory.getService(name) ?? this.accessory.addService(this.platform.Service.Valve, name, zone),
        Active: this.platform.Characteristic.Active.INACTIVE as CharacteristicValue,
        InUse: this.platform.Characteristic.InUse.NOT_IN_USE as CharacteristicValue,
      });

      // Add Valve Service's Characteristics
      this.valves
        .get(zone)!
        .service.setCharacteristic(this.platform.Characteristic.Name, name)
        .setCharacteristic(this.platform.Characteristic.Active, this.valves.get(zone)!.Active)
        .setCharacteristic(this.platform.Characteristic.InUse, this.valves.get(zone)!.InUse)
        .setCharacteristic(this.platform.Characteristic.ValveType, this.platform.Characteristic.ValveType.IRRIGATION)
        .setCharacteristic(this.platform.Characteristic.SetDuration, this.accessory.context.duration[zone])
        .setCharacteristic(this.platform.Characteristic.RemainingDuration, 0)
        .setCharacteristic(this.platform.Characteristic.IsConfigured, this.accessory.context.configured[zone])
        .setCharacteristic(this.platform.Characteristic.ServiceLabelIndex, zone)
        .setCharacteristic(this.platform.Characteristic.StatusFault, this.platform.Characteristic.StatusFault.NO_FAULT);

      this.irrigation.service.addLinkedService(this.valves.get(zone)!.service);

      // Create handlers for required Valve characteristics
      this.debugLog(`Configure Characteristics for ${name}`);

      this.valves
        .get(zone)!
        .service.getCharacteristic(this.platform.Characteristic.Active)
        .onGet(() => {
          this.rainbird!.refreshStatus();
          return this.valves.get(zone)!.Active;
        })
        .onSet(this.setValveActive.bind(this, zone));

      this.valves
        .get(zone)!
        .service.getCharacteristic(this.platform.Characteristic.InUse)
        .onGet(() => {
          this.rainbird!.refreshStatus();
          return this.valves.get(zone)!.InUse;
        });

      this.valves
        .get(zone)!
        .service.getCharacteristic(this.platform.Characteristic.IsConfigured)
        .onGet(() => {
          return this.valves.get(zone)!.service.getCharacteristic(this.platform.Characteristic.IsConfigured).value;
        })
        .onSet(this.setValveIsConfigured.bind(this, zone));

      this.valves
        .get(zone)!
        .service.getCharacteristic(this.platform.Characteristic.StatusFault)
        .onGet(() => {
          return this.valves.get(zone)!.service.getCharacteristic(this.platform.Characteristic.StatusFault).value;
        });

      this.valves
        .get(zone)!
        .service.getCharacteristic(this.platform.Characteristic.ValveType)
        .onGet(() => {
          return this.valves.get(zone)!.service.getCharacteristic(this.platform.Characteristic.ValveType).value;
        });

      this.valves
        .get(zone)!
        .service.getCharacteristic(this.platform.Characteristic.SetDuration)
        .onGet(() => {
          return Number(this.accessory.context.duration[zone]);
        })
        .onSet(this.setValveSetDuration.bind(this, zone));

      this.valves
        .get(zone)!
        .service.getCharacteristic(this.platform.Characteristic.RemainingDuration)
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
          this.debugLog(`${this.constructor.name} ${this.accessory.displayName} - ${JSON.stringify(e.messsage)}`);
          if (this.deviceLogging.includes('debug')) {
            this.debugLog(`${this.constructor.name} ${this.accessory.displayName} - ${JSON.stringify(e)}`);
          }
        }
        this.irrigationSystemUpdateInProgress = false;
      });
  }

  /**
   * Parse the device status from the RainbirdClient
   */
  parseStatus() {
    // Irrigation System
    this.irrigation.Active = this.rainbird!.isActive() ? this.platform.Characteristic.Active.ACTIVE : this.platform.Characteristic.Active.INACTIVE;

    this.irrigation.InUse = this.rainbird!.isInUse() ? this.platform.Characteristic.InUse.IN_USE : this.platform.Characteristic.InUse.NOT_IN_USE;
    this.debugLog(`${this.constructor.name}: ${this.accessory.displayName}, Active: ${this.irrigation.Active}, InUse: ${this.irrigation.InUse}`);

    // Valves
    for (const [zone, valve] of this.valves.entries()) {
      valve.Active = this.rainbird!.isActive(zone) ? this.platform.Characteristic.Active.ACTIVE : this.platform.Characteristic.Active.INACTIVE;

      valve.InUse = this.rainbird!.isInUse(zone) ? this.platform.Characteristic.InUse.IN_USE : this.platform.Characteristic.InUse.NOT_IN_USE;

      this.debugLog(`${this.constructor.name} Valve: ${zone}, Active: ${valve.Active}, InUse: ${valve.InUse}`);
    }
  }

  /**
   * Updates the status for each of the HomeKit Characteristics
   */
  updateHomeKitCharacteristics() {
    // Irrigation System
    if (this.irrigation.Active === undefined) {
      this.debugLog(`${this.constructor.name} ${this.accessory.displayName} Active: ${this.irrigation.Active}`);
    } else {
      this.irrigation.service.updateCharacteristic(this.platform.Characteristic.Active, this.irrigation.Active);
      this.debugLog(`${this.constructor.name} ${this.accessory.displayName} updateCharacteristic Active: ${this.irrigation.Active}`);
    }
    if (this.irrigation.InUse === undefined) {
      this.debugLog(`${this.constructor.name} ${this.accessory.displayName} InUse: ${this.irrigation.InUse}`);
    } else {
      this.irrigation.service.updateCharacteristic(this.platform.Characteristic.InUse, this.irrigation.InUse);
      this.debugLog(`${this.constructor.name} ${this.accessory.displayName} updateCharacteristic InUse: ${this.irrigation.InUse}`);
    }
    if (this.rainbird!.RemainingDuration() === undefined) {
      this.debugLog(`${this.constructor.name} ${this.accessory.displayName} RemainingDuration: ${this.rainbird!.RemainingDuration()}`);
    } else {
      this.irrigation.service.updateCharacteristic(this.platform.Characteristic.RemainingDuration, this.rainbird!.RemainingDuration());
      this.debugLog(
        `${this.constructor.name} ${this.accessory.displayName} updateCharacteristic RemainingDuration: ${this.rainbird!.RemainingDuration()}`);
    }

    // Valves
    for (const [zone, valve] of this.valves.entries()) {
      if (valve.Active === undefined) {
        this.debugLog(`${this.constructor.name} Valve ${zone} Active: ${valve.Active}`);
      } else {
        valve.service.updateCharacteristic(this.platform.Characteristic.Active, valve.Active);
        this.debugLog(`${this.constructor.name} Valve ${zone} updateCharacteristic Active: ${valve.Active}`);
      }
      if (valve.InUse === undefined) {
        this.debugLog(`${this.constructor.name} Valve ${zone} InUse: ${valve.InUse}`);
      } else {
        valve.service.updateCharacteristic(this.platform.Characteristic.InUse, valve.InUse);
        this.debugLog(`${this.constructor.name} Valve ${zone} updateCharacteristic InUse: ${valve.InUse}`);
      }
      if (this.accessory.context.duration[zone] === undefined) {
        this.debugLog(`${this.constructor.name} Valve ${zone} SetDuration: ${this.accessory.context.duration[zone]}`);
      } else {
        valve.service.updateCharacteristic(this.platform.Characteristic.SetDuration, this.accessory.context.duration[zone]);
        this.debugLog(`${this.constructor.name} Valve ${zone} updateCharacteristic SetDuration: ${this.accessory.context.duration[zone]}`);
      }
      if (this.accessory.context.configured[zone] === undefined) {
        this.debugLog(`${this.constructor.name} Valve ${zone} IsConfigured: ${this.accessory.context.configured[zone]}`);
      } else {
        valve.service.updateCharacteristic(this.platform.Characteristic.IsConfigured, this.accessory.context.configured[zone]);
        this.debugLog(`${this.constructor.name} Valve ${zone} updateCharacteristic IsConfigured: ${this.accessory.context.configured[zone]}`);
      }
      if (this.rainbird!.RemainingDuration(zone) === undefined) {
        this.debugLog(`${this.constructor.name} Valve ${zone} RemainingDuration: ${this.rainbird!.RemainingDuration(zone)}`);
      } else {
        valve.service.updateCharacteristic(this.platform.Characteristic.RemainingDuration, this.rainbird!.RemainingDuration(zone));
        this.debugLog(`${this.constructor.name} Valve ${zone} updateCharacteristic RemainingDuration: ${this.rainbird!.RemainingDuration(zone)}`);
      }
    }
  }

  /**
   * Pushes the requested changes to the RainbirdClient
   */
  async pushChanges(zone: number): Promise<void> {
    if (this.valves.get(zone)!.Active === this.platform.Characteristic.Active.ACTIVE) {
      this.rainbird!.activateZone(zone, this.accessory.context.duration[zone]);
    } else {
      await this.rainbird!.deactivateZone(zone);
    }

    this.debugLog(
      `${this.constructor.name} ${this.accessory.displayName}, pushChanges: [Valve: ${zone},` +
        ` Active: ${this.valves.get(zone)!.Active}, SetDuration: ${this.accessory.context.duration[zone]}]`,
    );
  }

  private setActive(value: CharacteristicValue) {
    this.debugLog(`${this.constructor.name} ${this.accessory.displayName}, Set Active: ${value}`);
    this.irrigation.Active = value;
  }

  private setValveActive(zone: number, value: CharacteristicValue) {
    this.debugLog(`${this.constructor.name} ${this.accessory.displayName}, Valve: ${zone}, Set Active: ${value}`);
    this.valves.get(zone)!.Active = value;
    this.doIrrigationSystemUpdate.next(zone);
  }

  private setValveIsConfigured(zone: number, value: CharacteristicValue) {
    this.debugLog(`${this.constructor.name} ${this.accessory.displayName}, Valve: ${zone}, Set IsConfigured: ${value}`);
    this.accessory.context.configured[zone] = value;
    this.rainbird!.enableZone(zone, value === this.platform.Characteristic.IsConfigured.CONFIGURED);
  }

  private setValveSetDuration(zone: number, value: CharacteristicValue) {
    this.debugLog(`${this.constructor.name} ${this.accessory.displayName}, Valve: ${zone}, Set SetDuration: ${value}`);
    this.accessory.context.duration[zone] = value;
  }

  config(device: DevicesConfig) {
    const config: DevicesConfig = device;
    if (Object.entries(config).length !== 0) {
      this.infoLog(`${this.constructor.name} ${this.accessory.displayName} Config: ${JSON.stringify(config)}`);
    }
  }
}
