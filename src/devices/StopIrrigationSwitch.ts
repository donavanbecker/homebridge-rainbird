import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { RainbirdPlatform } from '../platform';
import { RainBirdService } from '../RainBird/RainBirdService';
import { fromEvent } from 'rxjs';
import { DevicesConfig } from '../settings';

export class StopIrrigationSwitch {
  private stopIrrigationSwitch!: {
    service: Service;
    state: CharacteristicValue;
  };

  // Config
  deviceRefreshRate!: number;
  deviceLogging!: string;

  constructor(
    private readonly platform: RainbirdPlatform,
    private accessory: PlatformAccessory,
    public device: DevicesConfig,
    public rainbird: RainBirdService,
  ) {
    this.logs(device);
    this.refreshRate(device);
    // Set accessory information
    accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'RainBird')
      .setCharacteristic(this.platform.Characteristic.Model, accessory.context.model ?? rainbird!.model)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, accessory.context.deviceID ?? rainbird!.serialNumber)
      .setCharacteristic(this.platform.Characteristic.FirmwareRevision, accessory.context.FirmwareRevision ?? rainbird!.version)
      .getCharacteristic(this.platform.Characteristic.FirmwareRevision)
      .updateValue(accessory.context.FirmwareRevision);

    // Stop Irrigation Switch Service
    const name = 'Stop Irrigation';
    this.debugLog(`Load Switch Service for ${name}`);
    this.stopIrrigationSwitch = {
      service: this.accessory.getService(this.platform.Service.Switch) ?? this.accessory.addService(this.platform.Service.Switch),
      state: false,
    };

    // Add Contact Sensor's Characteristics
    this.stopIrrigationSwitch.service
      .setCharacteristic(this.platform.Characteristic.On, false)
      .setCharacteristic(this.platform.Characteristic.Name, name);

    this.stopIrrigationSwitch.service
      .getCharacteristic(this.platform.Characteristic.On)
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
    this.debugLog(`Stop Irrigation Switch: ${this.accessory.displayName}, Set On: ${value}`);
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
    this.debugLog(`Stop Irrigation Switch: ${this.accessory.displayName} On: ${this.stopIrrigationSwitch.state}`);
  }

  /**
   * Updates the status for each of the HomeKit Characteristics
   */
  updateHomeKitCharacteristics() {
    if (this.stopIrrigationSwitch.state === undefined) {
      this.debugLog(`Stop Irrigation Switch: ${this.accessory.displayName} On: ${this.stopIrrigationSwitch.state}`);
    } else {
      this.stopIrrigationSwitch.service.updateCharacteristic(this.platform.Characteristic.On, this.stopIrrigationSwitch.state);
      this.debugLog(`Stop Irrigation Switch: ${this.accessory.displayName} On: ${this.stopIrrigationSwitch.state}`);
    }
  }

  refreshRate(device: DevicesConfig) {
    if (device.refreshRate) {
      this.deviceRefreshRate = this.accessory.context.refreshRate = device.refreshRate;
      this.debugLog(`Stop Irrigation Switch: ${this.accessory.displayName} Using Device Config refreshRate: ${this.deviceRefreshRate}`);
    } else if (this.platform.config.options!.refreshRate) {
      this.deviceRefreshRate = this.accessory.context.refreshRate = this.platform.config.options!.refreshRate;
      this.debugLog(`Stop Irrigation Switch: ${this.accessory.displayName} Using Platform Config refreshRate: ${this.deviceRefreshRate}`);
    }
  }

  logs(device: DevicesConfig) {
    if (this.platform.debugMode) {
      this.deviceLogging = this.accessory.context.logging = 'debugMode';
      this.debugLog(`Stop Irrigation Switch: ${this.accessory.displayName} Using Debug Mode Logging: ${this.deviceLogging}`);
    } else if (device.logging) {
      this.deviceLogging = this.accessory.context.logging = device.logging;
      this.debugLog(`Stop Irrigation Switch: ${this.accessory.displayName} Using Device Config Logging: ${this.deviceLogging}`);
    } else if (this.platform.config.options?.logging) {
      this.deviceLogging = this.accessory.context.logging = this.platform.config.options?.logging;
      this.debugLog(`Stop Irrigation Switch: ${this.accessory.displayName} Using Platform Config Logging: ${this.deviceLogging}`);
    } else {
      this.deviceLogging = this.accessory.context.logging = 'standard';
      this.debugLog(`Stop Irrigation Switch: ${this.accessory.displayName} Logging Not Set, Using: ${this.deviceLogging}`);
    }
  }

  /**
   * Logging for Device
   */
  infoLog(...log: any[]) {
    if (this.enablingDeviceLogging()) {
      this.platform.log.info(String(...log));
    }
  }

  warnLog(...log: any[]) {
    if (this.enablingDeviceLogging()) {
      this.platform.log.warn(String(...log));
    }
  }

  errorLog(...log: any[]) {
    if (this.enablingDeviceLogging()) {
      this.platform.log.error(String(...log));
    }
  }

  debugLog(...log: any[]) {
    if (this.enablingDeviceLogging()) {
      if (this.deviceLogging === 'debug') {
        this.platform.log.info('[DEBUG]', String(...log));
      } else {
        this.platform.log.debug(String(...log));
      }
    }
  }

  enablingDeviceLogging(): boolean {
    return this.deviceLogging.includes('debug') || this.deviceLogging === 'standard';
  }
}
