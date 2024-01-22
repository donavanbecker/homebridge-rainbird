import { Service, CharacteristicValue, PlatformAccessory } from 'homebridge';
import { RainbirdPlatform } from '../platform.js';
import { RainBirdService } from 'rainbird';
import { fromEvent } from 'rxjs';
import { DevicesConfig } from '../settings.js';
import { DeviceBase } from './DeviceBase';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class ContactSensor extends DeviceBase {
  // Service
  private contactSensor!: {
    service: Service;
    state: CharacteristicValue;
  };

  constructor(
    readonly platform: RainbirdPlatform,
    accessory: PlatformAccessory,
    device: DevicesConfig,
    rainbird: RainBirdService,
  ) {
    super(platform, accessory, device, rainbird);

    // Contact Sensor Service
    const name = `Zone ${accessory.context.zoneId}`;
    this.debugLog(`Load Contact Sensor Service for ${name}`);
    this.contactSensor = {
      service: this.accessory.getService(this.hap.Service.ContactSensor) ?? this.accessory.addService(this.hap.Service.ContactSensor),
      state: this.hap.Characteristic.ContactSensorState.CONTACT_DETECTED,
    };

    // Add Contact Sensor's Characteristics
    this.contactSensor.service
      .setCharacteristic(this.hap.Characteristic.ContactSensorState, this.hap.Characteristic.ContactSensorState.CONTACT_DETECTED)
      .setCharacteristic(this.hap.Characteristic.Name, name)
      .setCharacteristic(this.hap.Characteristic.StatusFault, this.hap.Characteristic.StatusFault.NO_FAULT);

    this.contactSensor.service.getCharacteristic(this.hap.Characteristic.ContactSensorState).onGet(() => {
      this.rainbird!.refreshStatus();
      return this.contactSensor.state;
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
  }

  /**
   * Parse the device status from the RainbirdClient
   */
  parseStatus() {
    this.contactSensor.state = this.rainbird!.isInUse(this.accessory.context.zoneId)
      ? this.hap.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
      : this.hap.Characteristic.ContactSensorState.CONTACT_DETECTED;
    this.debugLog(`${this.constructor.name}: ${this.accessory.displayName}, ContactSensorState: ${this.contactSensor.state}`);
  }

  /**
   * Updates the status for each of the HomeKit Characteristics
   */
  updateHomeKitCharacteristics() {
    // Valves
    if (this.contactSensor.state === undefined) {
      this.debugLog(
        `${this.constructor.name} ${this.accessory.displayName} ContactSensorState: ${this.contactSensor.state}, ${this.accessory.context.zoneId}`);
    } else {
      this.contactSensor.service.updateCharacteristic(this.hap.Characteristic.ContactSensorState, this.contactSensor.state);
      this.debugLog(
        `${this.constructor.name} ${this.accessory.displayName} ContactSensorState: ${this.contactSensor.state}, ${this.accessory.context.zoneId}`);
    }
  }
}
