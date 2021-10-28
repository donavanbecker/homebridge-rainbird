import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { RainbirdPlatform } from '../platform';
import { RainBirdService } from '../RainBird/RainBirdService';
import { fromEvent } from 'rxjs';
import { DevicesConfig } from '../settings';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class ContactSensor {
  private contactSensor!: {
    service: Service,
    state: CharacteristicValue
  };

  constructor(
    private readonly platform: RainbirdPlatform,
    private accessory: PlatformAccessory,
    public device: DevicesConfig,
    public rainbird: RainBirdService,
  ) {
    // Set accessory information
    accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'RainBird')
      .setCharacteristic(this.platform.Characteristic.Model, accessory.context.model ?? rainbird!.model)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, accessory.context.deviceID ?? rainbird!.serialNumber)
      .setCharacteristic(this.platform.Characteristic.FirmwareRevision, accessory.context.FirmwareRevision ?? rainbird!.version)
      .getCharacteristic(this.platform.Characteristic.FirmwareRevision).updateValue(accessory.context.FirmwareRevision);

    // Contact Sensor Service
    const name = `Zone ${accessory.context.zoneId}`;
    this.platform.device(`Load Contact Sensor Service for ${name}`);
    this.contactSensor = {
      service: this.accessory.getService(this.platform.Service.ContactSensor) ??
        this.accessory.addService(this.platform.Service.ContactSensor),
      state: this.platform.Characteristic.ContactSensorState.CONTACT_DETECTED,
    };

    // Add Contact Sensor's Characteristics
    this.contactSensor.service
      .setCharacteristic(this.platform.Characteristic.ContactSensorState, this.platform.Characteristic.ContactSensorState.CONTACT_DETECTED)
      .setCharacteristic(this.platform.Characteristic.Name, name)
      .setCharacteristic(this.platform.Characteristic.StatusFault, this.platform.Characteristic.StatusFault.NO_FAULT);

    this.contactSensor.service.getCharacteristic(this.platform.Characteristic.ContactSensorState)
      .onGet(() => {
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
      ? this.platform.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
      : this.platform.Characteristic.ContactSensorState.CONTACT_DETECTED;
    this.platform.debug(`Contact Sensor: ${this.accessory.context.zoneId}, ContactSensorState: ${this.contactSensor.state}`);
  }

  /**
   * Updates the status for each of the HomeKit Characteristics
   */
  updateHomeKitCharacteristics() {
    // Valves
    if (this.contactSensor.state === undefined) {
      this.platform.debug(
        `Contact Sensor ${this.accessory.displayName} ContactSensorState: ${this.contactSensor.state}, ${this.accessory.context.zoneId}`);
    } else {
      this.contactSensor.service.updateCharacteristic(this.platform.Characteristic.ContactSensorState, this.contactSensor.state);
      this.platform.device(
        `Contact Sensor ${this.accessory.displayName} ContactSensorState: ${this.contactSensor.state}, ${this.accessory.context.zoneId}`);
    }
  }
}
