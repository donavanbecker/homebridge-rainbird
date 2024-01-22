import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { RainbirdPlatform } from '../platform';
import { RainBirdService } from 'rainbird';
import { fromEvent } from 'rxjs';
import { DevicesConfig } from '../settings';
import { DeviceBase } from './DeviceBase';

export class StopIrrigationSwitch extends DeviceBase {
  private stopIrrigationSwitch!: {
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

    // Stop Irrigation Switch Service
    const name = 'Stop Irrigation';
    this.debugLog(`Load Switch Service for ${name}`);
    this.stopIrrigationSwitch = {
      service: this.accessory.getService(this.hap.Service.Switch) ?? this.accessory.addService(this.hap.Service.Switch),
      state: false,
    };

    // Add Switch's Characteristics
    this.stopIrrigationSwitch.service
      .setCharacteristic(this.hap.Characteristic.On, false)
      .setCharacteristic(this.hap.Characteristic.Name, name);

    this.stopIrrigationSwitch.service
      .getCharacteristic(this.hap.Characteristic.On)
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
    this.debugLog(`${this.constructor.name}: ${this.accessory.displayName}, Set On: ${value}`);
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
    this.debugLog(`${this.constructor.name}: ${this.accessory.displayName} On: ${this.stopIrrigationSwitch.state}`);
  }

  /**
   * Updates the status for each of the HomeKit Characteristics
   */
  updateHomeKitCharacteristics() {
    if (this.stopIrrigationSwitch.state === undefined) {
      this.debugLog(`${this.constructor.name}: ${this.accessory.displayName} On: ${this.stopIrrigationSwitch.state}`);
    } else {
      this.stopIrrigationSwitch.service.updateCharacteristic(this.hap.Characteristic.On, this.stopIrrigationSwitch.state);
      this.debugLog(`${this.constructor.name}: ${this.accessory.displayName} updateCharacteristic On: ${this.stopIrrigationSwitch.state}`);
    }
  }
}
