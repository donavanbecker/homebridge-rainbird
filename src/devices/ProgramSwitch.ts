import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { RainbirdPlatform } from '../platform';
import { RainBirdService } from '../RainBird/RainBirdService';
import { fromEvent } from 'rxjs';
import { DevicesConfig } from '../settings';

export class ProgramSwitch {
  private programSwitch!: {
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

    // Program Switch Service
    const name = `Program ${accessory.context.programId}`;
    this.platform.device(`Load Switch Service for ${name}`);
    this.programSwitch = {
      service: this.accessory.getService(this.platform.Service.Switch) ??
        this.accessory.addService(this.platform.Service.Switch),
      state: false,
    };

    // Add Contact Sensor's Characteristics
    this.programSwitch.service
      .setCharacteristic(this.platform.Characteristic.On, false)
      .setCharacteristic(this.platform.Characteristic.Name, name);

    this.programSwitch.service.getCharacteristic(this.platform.Characteristic.On)
      .onGet(() => {
        this.rainbird!.refreshStatus();
        return this.programSwitch.state;
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
    this.programSwitch.state = value;
    if (value) {
      await this.rainbird!.runProgram(this.accessory.context.programId);
    } else {
      await this.rainbird!.stopIrrigation();
    }
  }

  /**
   * Parse the device status from the RainbirdClient
   */
  parseStatus() {
    const isRunning = this.rainbird!.isProgramRunning(this.accessory.context.programId);
    if (isRunning !== undefined) {
      this.programSwitch.state = isRunning;
    } else {
      if (this.programSwitch.state && !this.rainbird!.isInUse()) {
        this.programSwitch.state = false;
      }
    }
    this.platform.debug(`Program Switch: ${this.accessory.context.programId}, On: ${this.programSwitch.state}`);
  }

  /**
   * Updates the status for each of the HomeKit Characteristics
   */
  updateHomeKitCharacteristics() {
    if (this.programSwitch.state === undefined) {
      this.platform.debug(`Switch ${this.accessory.displayName} On: ${this.programSwitch.state}`);
    } else {
      this.programSwitch.service.updateCharacteristic(this.platform.Characteristic.On, this.programSwitch.state);
      this.platform.device(`Switch ${this.accessory.displayName} On: ${this.programSwitch.state}`);
    }
  }
}
