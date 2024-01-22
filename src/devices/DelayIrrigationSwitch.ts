import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { RainbirdPlatform } from '../platform';
import { RainBirdService } from 'rainbird';
import { DevicesConfig } from '../settings';
import { DeviceBase } from './DeviceBase';

export class DelayIrrigationSwitch extends DeviceBase {
  // Service
  private service: Service;

  constructor(
    readonly platform: RainbirdPlatform,
    accessory: PlatformAccessory,
    device: DevicesConfig,
    rainbird: RainBirdService,
  ) {
    super(platform, accessory, device, rainbird);

    // Delay Irrigation Switch Service
    const name = 'Delay Irrigation';
    this.debugLog(`Load Switch Service for ${name}`);
    this.service = this.accessory.getService(this.hap.Service.Switch) ?? this.accessory.addService(this.hap.Service.Switch);

    // Add Switch's Characteristics
    this.service
      .setCharacteristic(this.hap.Characteristic.On, false)
      .setCharacteristic(this.hap.Characteristic.Name, name);

    this.service
      .getCharacteristic(this.hap.Characteristic.On)
      .onGet(async () => {
        const state = await this.rainbird!.getIrrigatinDelay() > 0;
        this.debugLog(`${this.constructor.name}: ${this.accessory.displayName} On: ${state}`);
        return state;
      })
      .onSet(async (value: CharacteristicValue) => {
        this.debugLog(`${this.constructor.name}: ${this.accessory.displayName}, Set On: ${value}`);
        if (value) {
          await this.rainbird!.setIrrigationDelay(this.device.irrigationDelay!);
        } else {
          await this.rainbird!.setIrrigationDelay(0);
        }
      });

    setInterval(async () => {
      await this.updateHomeKitCharacteristics();
    }, 3600000); // every hour
  }

  /**
   * Updates the status for each of the HomeKit Characteristics
   */
  private async updateHomeKitCharacteristics(): Promise<void> {
    const state = await this.rainbird!.getIrrigatinDelay() > 0;
    this.service.updateCharacteristic(this.hap.Characteristic.On, state);
    this.debugLog(`${this.constructor.name}: ${this.accessory.displayName} updateCharacteristic On: ${state}`);
  }
}
