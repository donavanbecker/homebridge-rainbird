import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { RainbirdPlatform } from '../platform';
import { RainBirdService } from '../RainBird/RainBirdService';
import { fromEvent } from 'rxjs';
import { DevicesConfig } from '../settings';

export class LeakSensor {
  private leakSensor!: {
    service: Service,
    leakDetected: CharacteristicValue
  }

  constructor(
    private readonly platform: RainbirdPlatform,
    private accessory: PlatformAccessory,
    public device: DevicesConfig,
    public rainbird: RainBirdService,
  ) {

    const model = 'WR2';

    // Set accessory information
    accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'RainBird')
      .setCharacteristic(this.platform.Characteristic.Model, accessory.context.model ?? model)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, accessory.context.deviceID ?? rainbird!.serialNumber)
      .setCharacteristic(this.platform.Characteristic.FirmwareRevision, accessory.context.FirmwareRevision ?? rainbird!.version)
      .getCharacteristic(this.platform.Characteristic.FirmwareRevision).updateValue(accessory.context.FirmwareRevision);

    // Leak Sensor Service
    this.platform.debug('Configure Leak Sensor Service');
    this.leakSensor = {
      service: this.accessory.getService(this.platform.Service.LeakSensor) ??
        this.accessory.addService(this.platform.Service.LeakSensor),
      leakDetected: this.platform.Characteristic.LeakDetected.LEAK_NOT_DETECTED,
    };

    // Add Leak Sensor's Characteristics
    this.leakSensor.service
      .setCharacteristic(this.platform.Characteristic.LeakDetected, this.platform.Characteristic.LeakDetected.LEAK_NOT_DETECTED)
      .setCharacteristic(this.platform.Characteristic.Name, model)
      .setCharacteristic(this.platform.Characteristic.StatusFault, this.platform.Characteristic.StatusFault.NO_FAULT);

    this.leakSensor.service.getCharacteristic(this.platform.Characteristic.LeakDetected)
      .onGet(() => {
        this.rainbird!.refreshStatus();
        return this.leakSensor.leakDetected;
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
    this.leakSensor.leakDetected = this.rainbird!.rainSetPointReached
      ? this.platform.Characteristic.LeakDetected.LEAK_DETECTED
      : this.platform.Characteristic.LeakDetected.LEAK_NOT_DETECTED;
  }

  updateHomeKitCharacteristics() {
    if (this.leakSensor.leakDetected !== undefined) {
      this.leakSensor.service.updateCharacteristic(this.platform.Characteristic.LeakDetected, this.leakSensor.leakDetected);
    }
  }
}