/* Copyright(C) 2021-2024, donavanbecker (https://github.com/donavanbecker) & mantorok1 (https://github.com/mantorok1). All rights reserved.
 *
 * ZoneValue.ts: homebridge-rainbird.
 */
import { Service, PlatformAccessory, CharacteristicValue, UnknownContext } from 'homebridge';
import { RainBirdService } from 'rainbird';
import { fromEvent, interval, Subject } from 'rxjs';
import { debounceTime, skipWhile, tap } from 'rxjs/operators';

import { DeviceBase } from './DeviceBase.js';
import { DevicesConfig } from '../settings.js';
import { RainbirdPlatform } from '../platform.js';

export class ZoneValve extends DeviceBase {
  private zoneId: number;
  private zoneValve!: {
    service: Service;
    Active: CharacteristicValue;
    InUse: CharacteristicValue;
  };

  // Zone Valve Updates
  private zoneUpdateInProgress!: boolean;
  private doZoneUpdate: Subject<number>;

  constructor(
    readonly platform: RainbirdPlatform,
    accessory: PlatformAccessory,
    device: DevicesConfig,
    rainbird: RainBirdService,
    private irrigationContext: UnknownContext,
  ) {
    super(platform, accessory, device, rainbird);
    this.zoneId = this.accessory.context.zoneId;

    // this is subject we use to track when we need to send changes to Rainbird Client
    this.doZoneUpdate = new Subject();
    this.zoneUpdateInProgress = false;

    if (irrigationContext.duration[this.zoneId] === undefined) {
      irrigationContext.duration[this.zoneId] = 300;
    }

    // Zone Valve Service
    const name = `Zone ${accessory.context.zoneId}`;
    this.debugLog(`Load Valve Service for ${name}`);
    this.zoneValve = {
      service: this.accessory.getService(this.hap.Service.Valve) ?? this.accessory.addService(this.hap.Service.Valve),
      Active: this.hap.Characteristic.Active.INACTIVE,
      InUse: this.hap.Characteristic.InUse.NOT_IN_USE,
    };

    // Add Valve's Characteristics
    this.zoneValve.service
      .setCharacteristic(this.hap.Characteristic.Active, this.zoneValve.Active)
      .setCharacteristic(this.hap.Characteristic.InUse, this.zoneValve.InUse)
      .setCharacteristic(this.hap.Characteristic.ValveType, this.hap.Characteristic.ValveType.IRRIGATION)
      .setCharacteristic(this.hap.Characteristic.Name, name)
      .setCharacteristic(this.hap.Characteristic.RemainingDuration, 0)
      .setCharacteristic(this.hap.Characteristic.SetDuration, irrigationContext.duration[this.zoneId])
      .setCharacteristic(this.hap.Characteristic.StatusFault, this.hap.Characteristic.StatusFault.NO_FAULT);

    this.zoneValve.service
      .getCharacteristic(this.hap.Characteristic.Active)
      .onGet(() => {
        this.rainbird!.refreshStatus();
        return this.zoneValve.Active;
      })
      .onSet(this.setActive.bind(this));

    this.zoneValve.service
      .getCharacteristic(this.hap.Characteristic.InUse)
      .onGet(() => {
        this.rainbird!.refreshStatus();
        return this.zoneValve.InUse;
      });

    this.zoneValve.service
      .getCharacteristic(this.hap.Characteristic.ValveType)
      .onGet(() => {
        return this.zoneValve.service.getCharacteristic(this.hap.Characteristic.ValveType).value;
      });

    this.zoneValve.service
      .getCharacteristic(this.hap.Characteristic.RemainingDuration)
      .setProps({
        minValue: device.minValueRemainingDuration,
        maxValue: device.maxValueRemainingDuration,
      })
      .onGet(() => {
        this.rainbird!.refreshStatus();
        return this.rainbird!.remainingDuration(this.zoneId);
      });

    this.zoneValve.service
      .getCharacteristic(this.hap.Characteristic.SetDuration)
      .onGet(() => {
        return Number(irrigationContext.duration[this.zoneId]);
      })
      .onSet(this.setSetDuration.bind(this));

    this.zoneValve.service
      .getCharacteristic(this.hap.Characteristic.StatusFault)
      .onGet(() => {
        return this.zoneValve.service.getCharacteristic(this.hap.Characteristic.StatusFault).value;
      });

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
      .pipe(skipWhile(() => this.zoneUpdateInProgress))
      .subscribe(() => {
        this.rainbird!.refreshStatus();
      });

    this.doZoneUpdate
      .pipe(
        tap(() => {
          this.zoneUpdateInProgress = true;
        }),
        debounceTime(this.platform.config.options!.pushRate! * 1000),
      )
      .subscribe(async (zone: number) => {
        try {
          await this.pushChanges(zone);
        } catch (e: any) {
          this.debugLog(`${this.constructor.name}: ${this.accessory.displayName} - ${JSON.stringify(e.messsage)}`);
          if (this.deviceLogging.includes('debug')) {
            this.debugLog(`${this.constructor.name}: ${this.accessory.displayName} - ${JSON.stringify(e)}`);
          }
        }
        this.zoneUpdateInProgress = false;
      });
  }

  async pushChanges(zone: number): Promise<void> {
    if (this.zoneValve.Active === this.hap.Characteristic.Active.ACTIVE) {
      this.rainbird!.activateZone(zone, this.irrigationContext.duration[this.zoneId]);
    } else {
      await this.rainbird!.deactivateZone(zone);
    }

    this.debugLog(
      `${this.constructor.name}: ${this.accessory.displayName}, pushChanges: [Valve: ${zone},` +
        ` Active: ${this.zoneValve.Active}, SetDuration: ${this.irrigationContext.duration[this.zoneId]}]`,
    );
  }

  private async setActive(value: CharacteristicValue) {
    this.debugLog(`${this.constructor.name}: ${this.accessory.displayName}, Set Active: ${value}`);
    this.zoneValve.Active = value;
    this.doZoneUpdate.next(this.zoneId);
  }

  private async setSetDuration(value: CharacteristicValue) {
    this.debugLog(`${this.constructor.name}: ${this.accessory.displayName}, Set SetDuration: ${value}`);
    this.irrigationContext.duration[this.zoneId] = value;
  }

  /**
   * Parse the device status from the RainbirdClient
   */
  parseStatus() {
    this.zoneValve.Active = this.rainbird!.isActive(this.zoneId)
      ? this.hap.Characteristic.Active.ACTIVE
      : this.hap.Characteristic.Active.INACTIVE;

    this.zoneValve.InUse = this.rainbird!.isInUse(this.zoneId)
      ? this.hap.Characteristic.InUse.IN_USE
      : this.hap.Characteristic.InUse.NOT_IN_USE;

    this.debugLog(`${this.constructor.name}: ${this.zoneId}, Active: ${this.zoneValve.Active}, InUse: ${this.zoneValve.InUse}`);
  }

  /**
   * Updates the status for each of the HomeKit Characteristics
   */
  updateHomeKitCharacteristics() {
    if (this.zoneValve.Active === undefined) {
      this.debugLog(`${this.constructor.name}: ${this.accessory.displayName} Active: ${this.zoneValve.Active}`);
    } else {
      this.zoneValve.service.updateCharacteristic(this.hap.Characteristic.Active, this.zoneValve.Active);
      this.debugLog(`${this.constructor.name}: ${this.accessory.displayName} updateCharacteristic Active: ${this.zoneValve.Active}`);
    }
    if (this.zoneValve.InUse === undefined) {
      this.debugLog(`${this.constructor.name}: ${this.accessory.displayName} InUse: ${this.zoneValve.InUse}`);
    } else {
      this.zoneValve.service.updateCharacteristic(this.hap.Characteristic.InUse, this.zoneValve.InUse);
      this.debugLog(`${this.constructor.name}: ${this.accessory.displayName} updateCharacteristic InUse: ${this.zoneValve.InUse}`);
    }
    const remainingDuration = this.rainbird!.remainingDuration(this.zoneId);
    if (remainingDuration === undefined) {
      this.debugLog(`${this.constructor.name}: ${this.accessory.displayName} RemainingDuration: ${remainingDuration}`);
    } else {
      this.zoneValve.service.updateCharacteristic(this.hap.Characteristic.RemainingDuration, remainingDuration);
      this.debugLog(`${this.constructor.name}: ${this.accessory.displayName} updateCharacteristic RemainingDuration: ${remainingDuration}`);
    }
    if (this.irrigationContext.duration[this.zoneId] === undefined) {
      this.debugLog(`${this.constructor.name}: ${this.accessory.displayName} SetDuration: ${this.irrigationContext.duration[this.zoneId]}`);
    } else {
      this.zoneValve.service.updateCharacteristic(this.hap.Characteristic.SetDuration, this.irrigationContext.duration[this.zoneId]);
      this.debugLog(
        `${this.constructor.name}: ${this.accessory.displayName} updateCharacteristic SetDuration: ${this.irrigationContext.duration[this.zoneId]}`);
    }
  }
}
