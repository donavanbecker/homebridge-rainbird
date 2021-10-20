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
export class ContactSensor {

  private valves: Map<number, {
    service: Service,
    ContactSensorState: CharacteristicValue,
  }> = new Map();

  // Irrigation System Updates
  private contactSensorUpdateInProgress!: boolean;
  private doContactSensorUpdate: Subject<number>;

  constructor(
    private readonly platform: RainbirdPlatform,
    private accessory: PlatformAccessory,
    public device: DevicesConfig,
    public rainbird: RainBirdService,
  ) {
    // this is subject we use to track when we need to send changes to Rainbird Client
    this.doContactSensorUpdate = new Subject();
    this.contactSensorUpdateInProgress = false;

    // Set accessory information
    accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'RainBird')
      .setCharacteristic(this.platform.Characteristic.Model, accessory.context.model ?? rainbird!.model)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, accessory.context.deviceID ?? rainbird!.serialNumber)
      .setCharacteristic(this.platform.Characteristic.FirmwareRevision, accessory.context.FirmwareRevision ?? rainbird!.version)
      .getCharacteristic(this.platform.Characteristic.FirmwareRevision).updateValue(accessory.context.FirmwareRevision);

    // Valves for zones
    for (const zone of rainbird!.zones) {
      const name = `Zone ${zone}`;
      this.platform.device(`Load Valve Service for ${name}`);
      this.valves.set(zone, {
        service: this.accessory.getService(name) ??
          this.accessory.addService(this.platform.Service.Valve, name, zone),
        ContactSensorState: this.platform.Characteristic.ContactSensorState.CONTACT_DETECTED,
      });

      // Add Valve Service's Characteristics
      this.valves.get(zone)!.service
        .setCharacteristic(this.platform.Characteristic.Name, name)
        .setCharacteristic(this.platform.Characteristic.ContactSensorState, this.valves.get(zone)!.ContactSensorState);

      // Create handlers for required Valve characteristics
      this.platform.device(`Configure Characteristics for ${name}`);

      this.valves.get(zone)!.service
        .getCharacteristic(this.platform.Characteristic.ContactSensorState)
        .onGet(() => {
          this.rainbird!.refreshStatus();
          return this.valves.get(zone)!.ContactSensorState;
        })
        .onSet(this.setValveActive.bind(this, zone));
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
      .pipe(skipWhile(() => this.contactSensorUpdateInProgress))
      .subscribe(() => {
        this.rainbird!.refreshStatus();
      });

    this.doContactSensorUpdate
      .pipe(
        tap(() => {
          this.contactSensorUpdateInProgress = true;
        }),
        debounceTime(this.platform.config.options!.pushRate! * 1000),
      )
      .subscribe(async () => {
        this.contactSensorUpdateInProgress = false;
      });
  }

  /**
   * Parse the device status from the RainbirdClient
   */
  parseStatus() {
    // Valves
    for (const [zone, valve] of this.valves.entries()) {
      valve.ContactSensorState = this.rainbird!.isActive(zone)
        ? this.platform.Characteristic.Active.ACTIVE
        : this.platform.Characteristic.Active.INACTIVE;
      this.platform.debug(`Valve: ${zone}, ContactSensorState: ${valve.ContactSensorState}`);
    }
  }

  /**
   * Updates the status for each of the HomeKit Characteristics
   */
  updateHomeKitCharacteristics() {
    // Valves
    for (const [zone, valve] of this.valves.entries()) {
      if (valve.ContactSensorState === undefined) {
        this.platform.debug(`Valve ${this.accessory.displayName} ContactSensorState: ${valve.ContactSensorState}, ${zone}`);
      } else {
        valve.service.updateCharacteristic(this.platform.Characteristic.Active, valve.ContactSensorState);
        this.platform.device(`Valve ${this.accessory.displayName} updateCharacteristic ContactSensorState: ${valve.ContactSensorState}, ${zone}`);
      }
    }
  }

  private setValveActive(zone: number, value: CharacteristicValue) {
    this.platform.device(`Irrigation System ${this.accessory.displayName}, Valve: ${zone}, Set ContactSensorState: ${value}`);
    this.valves.get(zone)!.ContactSensorState = value;
    this.doContactSensorUpdate.next(zone);
  }
}
