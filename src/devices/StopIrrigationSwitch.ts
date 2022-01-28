import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { RainbirdPlatform } from '../platform';
import { RainBirdService } from '../RainBird/RainBirdService';
import { fromEvent } from 'rxjs';
import { DevicesConfig } from '../settings';

export class StopIrrigationSwitch {
  private stopIrrigationSwitch!: {
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

    // Stop Irrigation Switch Service
    const name = 'Stop Irrigation';
    this.platform.device(`Load Switch Service for ${name}`);
    this.stopIrrigationSwitch = {
      service: this.accessory.getService(this.platform.Service.Switch) ??
        this.accessory.addService(this.platform.Service.Switch),
      state: false,
    };

    // Add Contact Sensor's Characteristics
    this.stopIrrigationSwitch.service
      .setCharacteristic(this.platform.Characteristic.On, false)
      .setCharacteristic(this.platform.Characteristic.Name, name);

    this.stopIrrigationSwitch.service.getCharacteristic(this.platform.Characteristic.On)
      .onGet(() => {
        this.rainbird!.refreshStatus();
        return this.stopIrrigationSwitch.state;
      })
      .onSet(this.setOn.bind(this));

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

  private async setOn(value: CharacteristicValue) {
    this.platform.device(`Switch ${this.accessory.displayName}, Set On: ${value}`);
    if (value) {
      this.rainbird!.deactivateAllZones();
      await this.rainbird!.stopIrrigation();
    }
    setTimeout(() => {
      this.updateHomeKitCharacteristics();
    }, 500);
  }

  /**
   * Parse the device status from the RainbirdClient
   */
  parseStatus() {
    this.platform.debug(`Switch ${this.accessory.displayName} On: ${this.stopIrrigationSwitch.state}`);
  }

  /**
   * Updates the status for each of the HomeKit Characteristics
   */
  updateHomeKitCharacteristics() {
    if (this.stopIrrigationSwitch.state === undefined) {
      this.platform.debug(`Switch ${this.accessory.displayName} On: ${this.stopIrrigationSwitch.state}`);
    } else {
      this.stopIrrigationSwitch.service.updateCharacteristic(this.platform.Characteristic.On, this.stopIrrigationSwitch.state);
      this.platform.device(`Switch ${this.accessory.displayName} On: ${this.stopIrrigationSwitch.state}`);
    }
  }
}
