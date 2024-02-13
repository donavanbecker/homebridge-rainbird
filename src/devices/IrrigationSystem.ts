/* Copyright(C) 2021-2024, donavanbecker (https://github.com/donavanbecker) & mantorok1 (https://github.com/mantorok1). All rights reserved.
 *
 * IrrigationSystem.ts: homebridge-rainbird.
 */
import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { RainBirdService } from 'rainbird';
import { Subject, fromEvent, interval } from 'rxjs';
import { debounceTime, skipWhile, tap } from 'rxjs/operators';

import { DeviceBase } from './DeviceBase.js';
import { DevicesConfig } from '../settings.js';
import { RainbirdPlatform } from '../platform.js';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class IrrigationSystem extends DeviceBase {
  // Service
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
      service: this.accessory.getService(this.hap.Service.IrrigationSystem) ?? this.accessory.addService(this.hap.Service.IrrigationSystem),
      Active: this.hap.Characteristic.Active.ACTIVE,
      InUse: this.hap.Characteristic.InUse.NOT_IN_USE,
    };

    // Add Irrigation Service's Characteristics
    this.irrigation.service
      .setCharacteristic(this.hap.Characteristic.Name, accessory.displayName)
      .setCharacteristic(this.hap.Characteristic.Active, this.irrigation.Active)
      .setCharacteristic(this.hap.Characteristic.InUse, this.irrigation.InUse)
      .setCharacteristic(this.hap.Characteristic.ProgramMode, this.hap.Characteristic.ProgramMode.NO_PROGRAM_SCHEDULED)
      .setCharacteristic(this.hap.Characteristic.RemainingDuration, 0)
      .setCharacteristic(this.hap.Characteristic.StatusFault, this.hap.Characteristic.StatusFault.NO_FAULT);

    // Create handlers for required characteristics
    this.irrigation.service
      .getCharacteristic(this.hap.Characteristic.Active)
      .onGet(() => {
        this.rainbird!.refreshStatus();
        return this.irrigation.Active;
      })
      .onSet(this.setActive.bind(this));

    this.irrigation.service
      .getCharacteristic(this.hap.Characteristic.ProgramMode)
      .onGet(() => {
        return this.irrigation.service.getCharacteristic(this.hap.Characteristic.ProgramMode).value;
      });

    this.irrigation.service
      .getCharacteristic(this.hap.Characteristic.InUse)
      .onGet(() => {
        this.rainbird!.refreshStatus();
        return this.irrigation.InUse;
      });

    this.irrigation.service
      .getCharacteristic(this.hap.Characteristic.StatusFault)
      .onGet(() => {
        return this.irrigation.service.getCharacteristic(this.hap.Characteristic.StatusFault).value;
      });

    this.irrigation.service
      .getCharacteristic(this.hap.Characteristic.RemainingDuration)
      .setProps({
        minValue: device.minValueRemainingDuration,
        maxValue: device.maxValueRemainingDuration! * rainbird!.zones.length,
      })
      .onGet(() => {
        this.rainbird!.refreshStatus();
        return this.rainbird!.remainingDuration();
      });

    // Valves for zones
    for (const zone of rainbird!.zones) {
      const name = `Zone ${zone}`;
      this.debugLog(`Load Valve Service for ${name}`);

      if (this.accessory.context.configured[zone] === undefined) {
        this.accessory.context.configured[zone] = this.hap.Characteristic.IsConfigured.CONFIGURED;
      }
      if (this.accessory.context.duration[zone] === undefined) {
        this.accessory.context.duration[zone] = 300;
      }

      this.valves.set(zone, {
        service: this.accessory.getService(name) ?? this.accessory.addService(this.hap.Service.Valve, name, `${zone}`),
        Active: this.hap.Characteristic.Active.INACTIVE as CharacteristicValue,
        InUse: this.hap.Characteristic.InUse.NOT_IN_USE as CharacteristicValue,
      });

      // Add Valve Service's Characteristics
      this.valves
        .get(zone)!
        .service.setCharacteristic(this.hap.Characteristic.Name, name)
        .setCharacteristic(this.hap.Characteristic.Active, this.valves.get(zone)!.Active)
        .setCharacteristic(this.hap.Characteristic.InUse, this.valves.get(zone)!.InUse)
        .setCharacteristic(this.hap.Characteristic.ValveType, this.hap.Characteristic.ValveType.IRRIGATION)
        .setCharacteristic(this.hap.Characteristic.SetDuration, this.accessory.context.duration[zone])
        .setCharacteristic(this.hap.Characteristic.RemainingDuration, 0)
        .setCharacteristic(this.hap.Characteristic.IsConfigured, this.accessory.context.configured[zone])
        .setCharacteristic(this.hap.Characteristic.ServiceLabelIndex, zone)
        .setCharacteristic(this.hap.Characteristic.StatusFault, this.hap.Characteristic.StatusFault.NO_FAULT);

      this.irrigation.service.addLinkedService(this.valves.get(zone)!.service);

      // Create handlers for required Valve characteristics
      this.debugLog(`Configure Characteristics for ${name}`);

      this.valves
        .get(zone)!
        .service.getCharacteristic(this.hap.Characteristic.Active)
        .onGet(() => {
          this.rainbird!.refreshStatus();
          return this.valves.get(zone)!.Active;
        })
        .onSet(this.setValveActive.bind(this, zone));

      this.valves
        .get(zone)!
        .service.getCharacteristic(this.hap.Characteristic.InUse)
        .onGet(() => {
          this.rainbird!.refreshStatus();
          return this.valves.get(zone)!.InUse;
        });

      this.valves
        .get(zone)!
        .service.getCharacteristic(this.hap.Characteristic.IsConfigured)
        .onGet(() => {
          return this.valves.get(zone)!.service.getCharacteristic(this.hap.Characteristic.IsConfigured).value;
        })
        .onSet(this.setValveIsConfigured.bind(this, zone));

      this.valves
        .get(zone)!
        .service.getCharacteristic(this.hap.Characteristic.StatusFault)
        .onGet(() => {
          return this.valves.get(zone)!.service.getCharacteristic(this.hap.Characteristic.StatusFault).value;
        });

      this.valves
        .get(zone)!
        .service.getCharacteristic(this.hap.Characteristic.ValveType)
        .onGet(() => {
          return this.valves.get(zone)!.service.getCharacteristic(this.hap.Characteristic.ValveType).value;
        });

      this.valves
        .get(zone)!
        .service.getCharacteristic(this.hap.Characteristic.SetDuration)
        .onGet(() => {
          return Number(this.accessory.context.duration[zone]);
        })
        .onSet(this.setValveSetDuration.bind(this, zone));

      this.valves
        .get(zone)!
        .service.getCharacteristic(this.hap.Characteristic.RemainingDuration)
        .setProps({
          minValue: device.minValueRemainingDuration,
          maxValue: device.maxValueRemainingDuration,
        })
        .onGet(() => {
          this.rainbird!.refreshStatus();
          return this.rainbird!.remainingDuration(zone);
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
    this.irrigation.Active = this.rainbird!.isActive() ? this.hap.Characteristic.Active.ACTIVE : this.hap.Characteristic.Active.INACTIVE;

    this.irrigation.InUse = this.rainbird!.isInUse() ? this.hap.Characteristic.InUse.IN_USE : this.hap.Characteristic.InUse.NOT_IN_USE;
    this.debugLog(`${this.constructor.name}: ${this.accessory.displayName}, Active: ${this.irrigation.Active}, InUse: ${this.irrigation.InUse}`);

    // Valves
    for (const [zone, valve] of this.valves.entries()) {
      valve.Active = this.rainbird!.isActive(zone) ? this.hap.Characteristic.Active.ACTIVE : this.hap.Characteristic.Active.INACTIVE;

      valve.InUse = this.rainbird!.isInUse(zone) ? this.hap.Characteristic.InUse.IN_USE : this.hap.Characteristic.InUse.NOT_IN_USE;

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
      this.irrigation.service.updateCharacteristic(this.hap.Characteristic.Active, this.irrigation.Active);
      this.debugLog(`${this.constructor.name} ${this.accessory.displayName} updateCharacteristic Active: ${this.irrigation.Active}`);
    }
    if (this.irrigation.InUse === undefined) {
      this.debugLog(`${this.constructor.name} ${this.accessory.displayName} InUse: ${this.irrigation.InUse}`);
    } else {
      this.irrigation.service.updateCharacteristic(this.hap.Characteristic.InUse, this.irrigation.InUse);
      this.debugLog(`${this.constructor.name} ${this.accessory.displayName} updateCharacteristic InUse: ${this.irrigation.InUse}`);
    }
    if (this.rainbird!.remainingDuration() === undefined) {
      this.debugLog(`${this.constructor.name} ${this.accessory.displayName} RemainingDuration: ${this.rainbird!.remainingDuration()}`);
    } else {
      this.irrigation.service.updateCharacteristic(this.hap.Characteristic.RemainingDuration, this.rainbird!.remainingDuration());
      this.debugLog(
        `${this.constructor.name} ${this.accessory.displayName} updateCharacteristic RemainingDuration: ${this.rainbird!.remainingDuration()}`);
    }

    // Valves
    for (const [zone, valve] of this.valves.entries()) {
      if (valve.Active === undefined) {
        this.debugLog(`${this.constructor.name} Valve ${zone} Active: ${valve.Active}`);
      } else {
        valve.service.updateCharacteristic(this.hap.Characteristic.Active, valve.Active);
        this.debugLog(`${this.constructor.name} Valve ${zone} updateCharacteristic Active: ${valve.Active}`);
      }
      if (valve.InUse === undefined) {
        this.debugLog(`${this.constructor.name} Valve ${zone} InUse: ${valve.InUse}`);
      } else {
        valve.service.updateCharacteristic(this.hap.Characteristic.InUse, valve.InUse);
        this.debugLog(`${this.constructor.name} Valve ${zone} updateCharacteristic InUse: ${valve.InUse}`);
      }
      if (this.accessory.context.duration[zone] === undefined) {
        this.debugLog(`${this.constructor.name} Valve ${zone} SetDuration: ${this.accessory.context.duration[zone]}`);
      } else {
        valve.service.updateCharacteristic(this.hap.Characteristic.SetDuration, this.accessory.context.duration[zone]);
        this.debugLog(`${this.constructor.name} Valve ${zone} updateCharacteristic SetDuration: ${this.accessory.context.duration[zone]}`);
      }
      if (this.accessory.context.configured[zone] === undefined) {
        this.debugLog(`${this.constructor.name} Valve ${zone} IsConfigured: ${this.accessory.context.configured[zone]}`);
      } else {
        valve.service.updateCharacteristic(this.hap.Characteristic.IsConfigured, this.accessory.context.configured[zone]);
        this.debugLog(`${this.constructor.name} Valve ${zone} updateCharacteristic IsConfigured: ${this.accessory.context.configured[zone]}`);
      }
      if (this.rainbird!.remainingDuration(zone) === undefined) {
        this.debugLog(`${this.constructor.name} Valve ${zone} RemainingDuration: ${this.rainbird!.remainingDuration(zone)}`);
      } else {
        valve.service.updateCharacteristic(this.hap.Characteristic.RemainingDuration, this.rainbird!.remainingDuration(zone));
        this.debugLog(`${this.constructor.name} Valve ${zone} updateCharacteristic RemainingDuration: ${this.rainbird!.remainingDuration(zone)}`);
      }
    }
  }

  /**
   * Pushes the requested changes to the RainbirdClient
   */
  async pushChanges(zone: number): Promise<void> {
    if (this.valves.get(zone)!.Active === this.hap.Characteristic.Active.ACTIVE) {
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
    this.rainbird!.enableZone(zone, value === this.hap.Characteristic.IsConfigured.CONFIGURED);
  }

  private setValveSetDuration(zone: number, value: CharacteristicValue) {
    this.debugLog(`${this.constructor.name} ${this.accessory.displayName}, Valve: ${zone}, Set SetDuration: ${value}`);
    this.accessory.context.duration[zone] = value;
  }
}
