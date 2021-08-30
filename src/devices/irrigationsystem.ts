import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { RainbirdPlatform } from '../platform';
import { RainBirdClient } from '../RainBirdClient/RainBirdClient';
import { interval, Subject } from 'rxjs';
import { debounceTime, skipWhile, tap } from 'rxjs/operators';
import { DevicesConfig } from '../settings';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class IrrigationSystem {
  private service!: Service;
  valveService!: Service;

  // Irrigation System Characteristics
  Active!: CharacteristicValue;
  InUse!: CharacteristicValue;
  RemainingDuration!: CharacteristicValue;

  // Valve Characteristics
  ValveActive!: CharacteristicValue;
  ValveInUse!: CharacteristicValue;
  ValveSetDuration!: CharacteristicValue;
  ValveRemainingDuration!: CharacteristicValue;
  ValveServiceLabelIndex!: CharacteristicValue;

  // Others
  valveZone!: number;
  zoneName!: string;

  //Irrigation System Updates
  irrigationSystemUpdateInProgress!: boolean;
  doIrrigationSystemUpdate//!: Subject<any>;
  IsConfigured: any;

  constructor(
    private readonly platform: RainbirdPlatform,
    private accessory: PlatformAccessory,
    public device: DevicesConfig,
    public rainbird: RainBirdClient,
  ) {
    // Initiliase device details
    rainbird!.on('status', this.refreshStatus);

    // this is subject we use to track when we need to send changes to Rainbird Client
    this.doIrrigationSystemUpdate = new Subject();
    this.irrigationSystemUpdateInProgress = false;

    // Set accessory information
    accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'RainBird')
      .setCharacteristic(this.platform.Characteristic.Model, accessory.context.model || rainbird!.model)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, accessory.context.deviceID || rainbird!.serialNumber)
      .setCharacteristic(this.platform.Characteristic.FirmwareRevision, accessory.context.FirmwareRevision || rainbird!.version)
      .getCharacteristic(this.platform.Characteristic.FirmwareRevision).updateValue(accessory.context.FirmwareRevision);

    // Irrigation Service
    this.platform.log.debug('Configure Irrigation Service');
    (this.service =
      this.accessory.getService(this.platform.Service.IrrigationSystem) ||
      this.accessory.addService(this.platform.Service.IrrigationSystem)), accessory.displayName;

    // Service Name
    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.displayName);
    // Required Characteristics" see https://developers.homebridge.io/#/service/IrrigationSystem

    // Add Irrigation Service's Characteristics
    this.service
      .setCharacteristic(this.platform.Characteristic.Active, this.platform.Characteristic.Active.ACTIVE)
      .setCharacteristic(this.platform.Characteristic.InUse, this.platform.Characteristic.InUse.NOT_IN_USE)
      .setCharacteristic(this.platform.Characteristic.ProgramMode, this.platform.Characteristic.ProgramMode.NO_PROGRAM_SCHEDULED)
      .setCharacteristic(this.platform.Characteristic.RemainingDuration, 0)
      .setCharacteristic(this.platform.Characteristic.StatusFault, this.platform.Characteristic.StatusFault.NO_FAULT);

    // Create handlers for required characteristics
    this.service.getCharacteristic(this.platform.Characteristic.Active)
      .onGet(() => {
        return this.Active;
      })
      .onSet(this.setActive.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.ProgramMode)
      .onGet(() => {
        return this.service.getCharacteristic(this.platform.Characteristic.ProgramMode).value;
      });

    this.service.getCharacteristic(this.platform.Characteristic.InUse)
      .onGet(() => {
        return this.InUse;
      });

    this.service.getCharacteristic(this.platform.Characteristic.StatusFault)
      .onGet(() => {
        return this.service.getCharacteristic(this.platform.Characteristic.StatusFault).value;
      });

    this.service.getCharacteristic(this.platform.Characteristic.RemainingDuration)
      .onGet(() => {
        return this.RemainingDuration;
      });

    // Valves for zones
    for (const zone of rainbird!.zones) {
      if (this.platform.debugMode) {
        this.platform.log.warn('Adding service');
      }
      this.zoneName = `Zone ${zone}`;
      this.platform.log.debug('Create Valve service for zone', zone);
      this.valveService = this.accessory.getService(this.zoneName) ||
      this.accessory.addService(this.platform.Service.Valve, this.zoneName, zone);
      this.valveService
        .setCharacteristic(this.platform.Characteristic.Name, this.zoneName)
        .setCharacteristic(this.platform.Characteristic.Active, this.platform.Characteristic.Active.INACTIVE)
        .setCharacteristic(this.platform.Characteristic.InUse, this.platform.Characteristic.InUse.NOT_IN_USE)
        .setCharacteristic(this.platform.Characteristic.ValveType, this.platform.Characteristic.ValveType.IRRIGATION)
        .setCharacteristic(this.platform.Characteristic.SetDuration, 300)
        .setCharacteristic(this.platform.Characteristic.RemainingDuration, 0)
        .setCharacteristic(this.platform.Characteristic.IsConfigured, this.platform.Characteristic.IsConfigured.CONFIGURED)
        .setCharacteristic(this.platform.Characteristic.ServiceLabelIndex, zone)
        .setCharacteristic(this.platform.Characteristic.StatusFault, this.platform.Characteristic.StatusFault.NO_FAULT);

      this.service.addLinkedService(this.valveService);
      this.valveZone = this.valveService.getCharacteristic(this.platform.Characteristic.ServiceLabelIndex).value as number;
      this.platform.log.debug('Configure Valve service for zone', this.valveZone);

      this.valveService
        .getCharacteristic(this.platform.Characteristic.Active)
        .onGet(() => {
          return this.ValveActive;
        })
        .onSet(this.setValveActive.bind(this));

      this.valveService
        .getCharacteristic(this.platform.Characteristic.InUse)
        .onGet(() => {
          return this.ValveInUse;
        });

      this.valveService
        .getCharacteristic(this.platform.Characteristic.IsConfigured)
        .onGet(() => {
          return this.valveService.getCharacteristic(this.platform.Characteristic.IsConfigured).value;
        })
        .onSet(this.setValveIsConfigured.bind(this));

      this.valveService
        .getCharacteristic(this.platform.Characteristic.StatusFault)
        .onGet(() => {
          return this.valveService.getCharacteristic(this.platform.Characteristic.StatusFault).value;
        });

      this.valveService
        .getCharacteristic(this.platform.Characteristic.ValveType)
        .onGet(() => {
          return this.valveService.getCharacteristic(this.platform.Characteristic.ValveType).value;
        });

      this.valveService
        .getCharacteristic(this.platform.Characteristic.SetDuration)
        .onGet(() => {
          return this.ValveSetDuration;
        })
        .onSet(this.setValveSetDuration.bind(this));

      this.valveService
        .getCharacteristic(this.platform.Characteristic.RemainingDuration)
        .onGet(() => {
          return this.ValveRemainingDuration;
        });

      //Initial Device Parse
      this.parseStatus();
    }

    // Start an update interval
    interval(this.platform.config.options!.refreshRate! * 1000)
      .pipe(skipWhile(() => this.irrigationSystemUpdateInProgress))
      .subscribe(() => {
        this.refreshStatus();
      });

    this.doIrrigationSystemUpdate
      .pipe(
        tap(() => {
          this.irrigationSystemUpdateInProgress = true;
        }),
        debounceTime(this.platform.config.options!.pushRate! * 1000),
      )
      .subscribe(async () => {
        try {
          await this.pushChanges();
        } catch (e: any) {
          this.platform.log.error(JSON.stringify(e.message));
          this.platform.log.debug('Irrigation System %s -', this.accessory.displayName, JSON.stringify(e));
          this.apiError(e);
        }
        this.irrigationSystemUpdateInProgress = false;
      });
  }

  /**
   * Parse the device status from the RainbirdClient
   */
  parseStatus() {
    // Irrigation Active
    if (this.rainbird!.isActive()) {
      this.Active = this.platform.Characteristic.Active.ACTIVE;
    } else {
      this.Active = this.platform.Characteristic.Active.INACTIVE;
    }
    // Irrigation InUse
    if (this.rainbird!.isInUse()) {
      this.InUse = this.platform.Characteristic.InUse.IN_USE;
    } else {
      this.InUse = this.platform.Characteristic.InUse.NOT_IN_USE;
    }
    // Irrigation Remaining Duration
    if (this.RemainingDuration !== undefined) {
      this.RemainingDuration = this.rainbird!.durationRemaining();
    }
    // Valve Active
    if (this.rainbird!.isActive(this.valveZone)) {
      this.ValveActive = this.platform.Characteristic.Active.ACTIVE;
    } else {
      this.ValveActive = this.platform.Characteristic.Active.INACTIVE;
    }
    // Valve InUse
    if (this.rainbird!.isInUse(this.valveZone)) {
      this.ValveInUse = this.platform.Characteristic.InUse.IN_USE;
    } else {
      this.ValveInUse = this.platform.Characteristic.InUse.NOT_IN_USE;
    }
    // Valve SetDuration
    if (this.ValveSetDuration !== undefined) {
      this.ValveSetDuration = this.rainbird!.duration(this.valveZone);
    }
    // Valve RemainingDuration
    if (this.ValveRemainingDuration !== undefined) {
      this.ValveRemainingDuration = this.rainbird!.durationRemaining(this.valveZone);
    }
  }

  /**
   * Asks the RainbirdClient for the latest device information
   */
  async refreshStatus() {
    try {
      this.platform.log.debug('Refreshing Status');

      for (const accessory of this.platform.accessories) {
        for (const service of accessory.services) {
          if (service instanceof this.platform.Service.IrrigationSystem) {
            service
              .getCharacteristic(this.platform.Characteristic.Active)
              .updateValue(this.rainbird!.isActive() ? this.platform.Characteristic.Active.ACTIVE : this.platform.Characteristic.Active.INACTIVE);
            service
              .getCharacteristic(this.platform.Characteristic.InUse)
              .updateValue(this.rainbird!.isInUse() ? this.platform.Characteristic.InUse.IN_USE : this.platform.Characteristic.InUse.NOT_IN_USE);
            service
              .getCharacteristic(this.platform.Characteristic.RemainingDuration)
              .updateValue(this.rainbird!.durationRemaining());
          } else if (service instanceof this.platform.Service.Valve) {
            const zone = service.getCharacteristic(this.platform.Characteristic.ServiceLabelIndex).value as number;
            service
              .getCharacteristic(this.platform.Characteristic.Active)
              .updateValue(this.rainbird!.isActive(zone) ? this.platform.Characteristic.Active.ACTIVE : this.platform.Characteristic.Active.INACTIVE);
            service
              .getCharacteristic(this.platform.Characteristic.InUse)
              .updateValue(this.rainbird!.isInUse(zone) ? this.platform.Characteristic.InUse.IN_USE : this.platform.Characteristic.InUse.NOT_IN_USE);
            service
              .getCharacteristic(this.platform.Characteristic.RemainingDuration)
              .updateValue(this.rainbird!.durationRemaining(zone));
          }
        }
      }
      this.parseStatus();
      this.updateHomeKitCharacteristics();
    } catch (e: any) {
      this.platform.log.error(
        'Irrigation System - Failed to update status of',
        this.accessory.displayName,
        JSON.stringify(e.message),
        this.platform.log.debug('Irrigation System %s -', this.accessory.displayName, JSON.stringify(e)),
      );
      this.apiError(e);
    }
  }

  /**
   * Pushes the requested changes to the RainbirdClient
   */
  async pushChanges() {
    this.rainbird!.setDuration(this.valveZone, Number(this.ValveSetDuration));
    if (this.ValveActive === this.platform.Characteristic.Active.ACTIVE) {
      this.rainbird!.activateZone(this.valveZone);
    } else {
      await this.rainbird!.deactivateZone(this.valveZone);
    }

    this.platform.log.debug(
      'Irrigation System %s pushChanges - [Valve Active: %s, Valve SetDuration: %s]',
      this.accessory.displayName,
      this.ValveActive,
      this.ValveSetDuration,
    );

    // Refresh the status from the RainbirdClient
    await this.refreshStatus();
  }

  /**
   * Updates the status for each of the HomeKit Characteristics
   */
  updateHomeKitCharacteristics() {
    if (this.Active !== undefined) {
      this.service?.updateCharacteristic(this.platform.Characteristic.Active, this.Active);
    }
    if (this.ValveActive !== undefined) {
      this.valveService?.updateCharacteristic(this.platform.Characteristic.Active, this.ValveActive);
    }
    if (this.ValveSetDuration !== undefined) {
      this.valveService?.updateCharacteristic(this.platform.Characteristic.SetDuration, this.ValveSetDuration);
    }
  }

  public apiError(e: any) {
    this.valveService.updateCharacteristic(this.platform.Characteristic.Active, e);
    this.valveService.updateCharacteristic(this.platform.Characteristic.SetDuration, e);
  }

  private setActive(value: CharacteristicValue) {
    this.service.getCharacteristic(this.platform.Characteristic.Active).updateValue(value);
    this.platform.log.debug('Irrigation System %s -', this.accessory.displayName, 'Set Active:', value);
    this.Active = value;
    this.doIrrigationSystemUpdate.next();
  }

  private setValveActive(value: CharacteristicValue) {
    this.platform.log.debug('Irrigation System %s -', this.accessory.displayName, 'Set Valve Active:', value);
    this.ValveActive = value;
    this.doIrrigationSystemUpdate.next();
  }

  private setValveIsConfigured(value: CharacteristicValue) {
    this.valveService.getCharacteristic(this.platform.Characteristic.IsConfigured).updateValue(value);
    this.platform.log.debug('Irrigation System %s -', this.accessory.displayName, 'Set Valve IsConfigured:', value);
    this.IsConfigured = value;
    this.doIrrigationSystemUpdate.next();
  }

  private setValveSetDuration(value: CharacteristicValue) {
    this.platform.log.debug('Irrigation System %s -', this.accessory.displayName, 'Set Valve SetDuration:', value);
    this.ValveSetDuration = value;
    this.doIrrigationSystemUpdate.next();
  }
}
