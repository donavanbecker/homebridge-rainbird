import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { RainbirdPlatform } from '../platform';
import { RainBirdService } from '../RainBird/RainBirdService';
import { Subject, fromEvent } from 'rxjs';
import { debounceTime, tap } from 'rxjs/operators';
import { DevicesConfig } from '../settings';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class IrrigationSystem {

  private irrigation!: {
    service: Service,
    active: CharacteristicValue;
    inUse: CharacteristicValue;
  }

  private valves: Map<number, {
    service: Service,
    active: CharacteristicValue,
    inUse: CharacteristicValue,
    setDuration: number,
    isConfigured: CharacteristicValue;
  }> = new Map()

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
      active: this.platform.Characteristic.Active.ACTIVE,
      inUse: this.platform.Characteristic.InUse.NOT_IN_USE,
    };

    // Add Irrigation Service's Characteristics
    this.irrigation.service
      .setCharacteristic(this.platform.Characteristic.Name, accessory.displayName)
      .setCharacteristic(this.platform.Characteristic.Active, this.irrigation.active)
      .setCharacteristic(this.platform.Characteristic.InUse, this.irrigation.inUse)
      .setCharacteristic(this.platform.Characteristic.ProgramMode, this.platform.Characteristic.ProgramMode.NO_PROGRAM_SCHEDULED)
      .setCharacteristic(this.platform.Characteristic.RemainingDuration, 0)
      .setCharacteristic(this.platform.Characteristic.StatusFault, this.platform.Characteristic.StatusFault.NO_FAULT);

    // Create handlers for required characteristics
    this.irrigation.service.getCharacteristic(this.platform.Characteristic.Active)
      .onGet(() => {
        this.rainbird!.refreshStatus();
        return this.irrigation.active;
      })
      .onSet(this.setActive.bind(this));

    this.irrigation.service.getCharacteristic(this.platform.Characteristic.ProgramMode)
      .onGet(() => {
        return this.irrigation.service.getCharacteristic(this.platform.Characteristic.ProgramMode).value;
      });

    this.irrigation.service.getCharacteristic(this.platform.Characteristic.InUse)
      .onGet(() => {
        this.rainbird!.refreshStatus();
        return this.irrigation.inUse;
      });

    this.irrigation.service.getCharacteristic(this.platform.Characteristic.StatusFault)
      .onGet(() => {
        return this.irrigation.service.getCharacteristic(this.platform.Characteristic.StatusFault).value;
      });

    this.irrigation.service.getCharacteristic(this.platform.Characteristic.RemainingDuration)
      .onGet(() => {
        this.rainbird!.refreshStatus();
        return this.rainbird!.durationRemaining();
      });

    // Valves for zones
    for (const zone of rainbird!.zones) {

      const name = `Zone ${zone}`;
      this.platform.debug(`Create Valve service for zone ${zone} ${name}`);
      this.valves.set(zone, {
        service: this.accessory.getService(name) ??
          this.accessory.addService(this.platform.Service.Valve, name, zone),
        active: this.platform.Characteristic.Active.INACTIVE as CharacteristicValue,
        inUse: this.platform.Characteristic.InUse.NOT_IN_USE as CharacteristicValue,
        setDuration: 300,
        isConfigured: this.platform.Characteristic.IsConfigured.CONFIGURED,
      });

      // Add Valve Service's Characteristics
      this.valves.get(zone)!.service
        .setCharacteristic(this.platform.Characteristic.Name, name)
        .setCharacteristic(this.platform.Characteristic.Active, this.valves.get(zone)!.active)
        .setCharacteristic(this.platform.Characteristic.InUse, this.valves.get(zone)!.inUse)
        .setCharacteristic(this.platform.Characteristic.ValveType, this.platform.Characteristic.ValveType.IRRIGATION)
        .setCharacteristic(this.platform.Characteristic.SetDuration, this.valves.get(zone)!.setDuration)
        .setCharacteristic(this.platform.Characteristic.RemainingDuration, 0)
        .setCharacteristic(this.platform.Characteristic.IsConfigured, this.valves.get(zone)!.isConfigured)
        .setCharacteristic(this.platform.Characteristic.ServiceLabelIndex, zone)
        .setCharacteristic(this.platform.Characteristic.StatusFault, this.platform.Characteristic.StatusFault.NO_FAULT);

      this.irrigation.service.addLinkedService(this.valves.get(zone)!.service);

      // Create handlers for required Valve characteristics
      this.platform.debug(`Configure Valve service for zone ${zone} ${name}`);

      this.valves.get(zone)!.service
        .getCharacteristic(this.platform.Characteristic.Active)
        .onGet(() => {
          this.rainbird!.refreshStatus();
          return this.valves.get(zone)!.active;
        })
        .onSet(this.setValveActive.bind(this, zone));

      this.valves.get(zone)!.service
        .getCharacteristic(this.platform.Characteristic.InUse)
        .onGet(() => {
          this.rainbird!.refreshStatus();
          return this.valves.get(zone)!.inUse;
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
          return Number(this.valves.get(zone)!.setDuration);
        })
        .onSet(this.setValveSetDuration.bind(this, zone));

      this.valves.get(zone)!.service
        .getCharacteristic(this.platform.Characteristic.RemainingDuration)
        .onGet(() => {
          this.rainbird!.refreshStatus();
          return this.rainbird!.durationRemaining(zone);
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
    this.irrigation.active = this.rainbird!.isActive()
      ? this.platform.Characteristic.Active.ACTIVE
      : this.platform.Characteristic.Active.INACTIVE;

    this.irrigation.inUse = this.rainbird!.isInUse()
      ? this.platform.Characteristic.InUse.IN_USE
      : this.platform.Characteristic.InUse.NOT_IN_USE;

    // Valves
    for (const [zone, valve] of this.valves.entries()) {
      valve.active = this.rainbird!.isActive(zone)
        ? this.platform.Characteristic.Active.ACTIVE
        : this.platform.Characteristic.Active.INACTIVE;

      valve.inUse = this.rainbird!.isInUse(zone)
        ? this.platform.Characteristic.InUse.IN_USE
        : this.platform.Characteristic.InUse.NOT_IN_USE;
    }
  }

  /**
   * Updates the status for each of the HomeKit Characteristics
   */
  updateHomeKitCharacteristics() {
    // Irrigation System
    if (this.irrigation.active !== undefined) {
      this.irrigation.service.updateCharacteristic(this.platform.Characteristic.Active, this.irrigation.active);
    }
    if (this.irrigation.inUse !== undefined) {
      this.irrigation.service.updateCharacteristic(this.platform.Characteristic.InUse, this.irrigation.inUse);
    }
    this.irrigation.service.updateCharacteristic(this.platform.Characteristic.RemainingDuration,
      this.rainbird!.durationRemaining());

    // Valves
    for(const [zone, valve] of this.valves.entries()) {
      if (valve.active !== undefined) {
        valve.service.updateCharacteristic(this.platform.Characteristic.Active, valve.active);
      }
      if (valve.inUse !== undefined) {
        valve.service.updateCharacteristic(this.platform.Characteristic.InUse, valve.inUse);
      }
      if (valve.setDuration !== undefined) {
        valve.service.updateCharacteristic(this.platform.Characteristic.SetDuration, valve.setDuration);
      }
      if (valve.isConfigured !== undefined) {
        valve.service.updateCharacteristic(this.platform.Characteristic.IsConfigured, valve.isConfigured);
      }
      valve.service.updateCharacteristic(this.platform.Characteristic.RemainingDuration,
        this.rainbird!.durationRemaining(zone));
    }
  }

  /**
   * Pushes the requested changes to the RainbirdClient
   */
  async pushChanges(zone: number): Promise<void> {
    if (this.valves.get(zone)!.active === this.platform.Characteristic.Active.ACTIVE) {
      this.rainbird!.activateZone(zone, this.valves.get(zone)!.setDuration);
    } else {
      await this.rainbird!.deactivateZone(zone);
    }

    this.platform.debug(`Irrigation System ${this.accessory.displayName},
     pushChanges: [Valve: ${zone}, Active: ${this.valves.get(zone)!.active}, SetDuration: ${this.valves.get(zone)!.setDuration}]`);
  }

  private setActive(value: CharacteristicValue) {
    this.platform.debug(`Irrigation System ${this.accessory.displayName}, Set Active: ${value}`);
    this.irrigation.active = value;
  }

  private setValveActive(zone: number, value: CharacteristicValue) {
    this.platform.debug(`Irrigation System ${this.accessory.displayName}, Valve: ${zone}, Set Active: ${value}`);
    this.valves.get(zone)!.active = value;
    this.doIrrigationSystemUpdate.next(zone);
  }

  private setValveIsConfigured(zone: number, value: CharacteristicValue) {
    this.platform.debug(`Irrigation System ${this.accessory.displayName}, Valve: ${zone}, Set IsConfigured: ${value}`);
    this.valves.get(zone)!.isConfigured = value;
    this.doIrrigationSystemUpdate.next(zone);
  }

  private setValveSetDuration(zone: number, value: CharacteristicValue) {
    this.platform.debug(`Irrigation System ${this.accessory.displayName}, Valve: ${zone}, Set SetDuration: ${value}`);
    this.valves.get(zone)!.setDuration = value as number;
    this.doIrrigationSystemUpdate.next(zone);
  }
}
