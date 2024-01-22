import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { RainbirdPlatform } from '../platform';
import { RainBirdService } from 'rainbird';
import { fromEvent } from 'rxjs';
import { DevicesConfig } from '../settings';
import { DeviceBase } from './DeviceBase';

export class LeakSensor extends DeviceBase {
  // Service
  private leakSensor!: {
    service: Service;
    LeakDetected: CharacteristicValue;
  };

  constructor(
    readonly platform: RainbirdPlatform,
    accessory: PlatformAccessory,
    device: DevicesConfig,
    rainbird: RainBirdService,
  ) {
    super(platform, accessory, device, rainbird);

    const model = 'WR2';

    // Leak Sensor Service
    this.debugLog('Configure Leak Sensor Service');
    this.leakSensor = {
      service: this.accessory.getService(this.hap.Service.LeakSensor) ?? this.accessory.addService(this.hap.Service.LeakSensor),
      LeakDetected: this.hap.Characteristic.LeakDetected.LEAK_NOT_DETECTED,
    };

    // Add Leak Sensor's Characteristics
    this.leakSensor.service
      .setCharacteristic(this.hap.Characteristic.LeakDetected, this.hap.Characteristic.LeakDetected.LEAK_NOT_DETECTED)
      .setCharacteristic(this.hap.Characteristic.Name, `${model} Leak Sensor`)
      .setCharacteristic(this.hap.Characteristic.StatusFault, this.hap.Characteristic.StatusFault.NO_FAULT);

    this.leakSensor.service.getCharacteristic(this.hap.Characteristic.LeakDetected).onGet(() => {
      this.rainbird!.refreshStatus();
      return this.leakSensor.LeakDetected;
    });

    // Initial Device Parse
    this.parseStatus();
    this.updateHomeKitCharacteristics();

    // Device Parse when status event emitted
    fromEvent(rainbird!, 'rain_sensor_state').subscribe({
      next: () => {
        this.parseStatus();
        this.updateHomeKitCharacteristics();
      },
    });
  }

  parseStatus() {
    this.leakSensor.LeakDetected = this.rainbird!.rainSetPointReached
      ? this.hap.Characteristic.LeakDetected.LEAK_DETECTED
      : this.hap.Characteristic.LeakDetected.LEAK_NOT_DETECTED;
  }

  updateHomeKitCharacteristics() {
    if (this.leakSensor.LeakDetected === undefined) {
      this.debugLog(`${this.constructor.name}: ${this.accessory.displayName} LeakDetected: ${this.leakSensor.LeakDetected}`);
    } else {
      this.leakSensor.service.updateCharacteristic(this.hap.Characteristic.LeakDetected, this.leakSensor.LeakDetected);
      this.debugLog(`${this.constructor.name}: ${this.accessory.displayName} updateCharacteristic LeakDetected: ${this.leakSensor.LeakDetected}`);
    }
  }
}
