import { Service, PlatformAccessory } from 'homebridge';
import { RainbirdPlatform } from '../platform';
import { RainBirdClient } from '../RainBirdClient/RainBirdClient';
import { DevicesConfig } from '../settings';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class Irrigation {
  private service!: Service;
  valveService!: Service;

  //Irrigation Updates
  valveUpdateInProgress!: boolean;
  doValveUpdate;//: Subject<any>;

  constructor(
    private readonly platform: RainbirdPlatform,
    private accessory: PlatformAccessory,
    public device: DevicesConfig,
    public rainbird: RainBirdClient,
  ) {
    // Initiliase device details
    rainbird!.init();
    rainbird!.on('status', this.updateValues.bind(this, rainbird));

    // set accessory information
    accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'RainBird')
      .setCharacteristic(this.platform.Characteristic.Model, accessory.context.model || rainbird!.model)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, accessory.context.deviceID || rainbird!.serialNumber)
      .setCharacteristic(this.platform.Characteristic.FirmwareRevision, accessory.context.FirmwareRevision || rainbird!.version)
      .getCharacteristic(this.platform.Characteristic.FirmwareRevision).updateValue(accessory.context.FirmwareRevision);

    // Display device details
    this.platform.log.info(`Model: ${rainbird!.model} [Version: ${rainbird!.version}]`);
    this.platform.log.info(`Serial Number: ${rainbird!.serialNumber}`);
    this.platform.log.info(`Zones: ${rainbird!.zones}`);


    //Irrigation Service
    this.platform.log.debug('Configure Irrigation service');
    (this.service =
      this.accessory.getService(this.platform.Service.IrrigationSystem) ||
      this.accessory.addService(this.platform.Service.IrrigationSystem)), accessory.displayName;

    //Service Name
    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.displayName);
    //Required Characteristics" see https://developers.homebridge.io/#/service/Irrigation

    //Add Irrigation Service's Characteristics
    accessory.addService(this.platform.Service.IrrigationSystem, rainbird!.model)
      .setCharacteristic(this.platform.Characteristic.Name, rainbird!.model)
      .setCharacteristic(this.platform.Characteristic.Active, this.platform.Characteristic.Active.ACTIVE)
      .setCharacteristic(this.platform.Characteristic.InUse, this.platform.Characteristic.InUse.NOT_IN_USE)
      .setCharacteristic(this.platform.Characteristic.ProgramMode, this.platform.Characteristic.ProgramMode.NO_PROGRAM_SCHEDULED)
      .setCharacteristic(this.platform.Characteristic.RemainingDuration, 0)
      .setCharacteristic(this.platform.Characteristic.StatusFault, this.platform.Characteristic.StatusFault.NO_FAULT);

    // create handlers for required characteristics
    this.service.getCharacteristic(this.platform.Characteristic.Active)
      .onGet(() => {
        return rainbird!.isActive()
          ? this.platform.Characteristic.Active.ACTIVE
          : this.platform.Characteristic.Active.INACTIVE;
      })
      .onSet((value) => {
        this.service
          .getCharacteristic(this.platform.Characteristic.Active).updateValue(value);
      });

    this.service.getCharacteristic(this.platform.Characteristic.ProgramMode)
      .onGet(() => {
        return this.service.getCharacteristic(this.platform.Characteristic.ProgramMode).value;
      });

    this.service.getCharacteristic(this.platform.Characteristic.InUse)
      .onGet(() => {
        return rainbird!.isInUse()
          ? this.platform.Characteristic.InUse.IN_USE
          : this.platform.Characteristic.InUse.NOT_IN_USE;
      });

    this.service.getCharacteristic(this.platform.Characteristic.StatusFault)
      .onGet(() => {
        return this.service.getCharacteristic(this.platform.Characteristic.StatusFault).value;
      });

    this.service.getCharacteristic(this.platform.Characteristic.RemainingDuration)
      .onGet(() => {
        return rainbird!.durationRemaining();
      });

    // Valves for zones
    for (const zone of rainbird!.zones) {
      if (this.platform.debugMode) {
        this.platform.log.warn('Adding service');
      }
      this.valveService = this.accessory.getService(`${rainbird.model} Zone: ${zone}`) ||
      this.accessory.addService(this.platform.Service.Valve, `${rainbird.model} Zone: ${zone}`);

      const zoneName = `Zone ${zone}`;
      this.valveService
        .setCharacteristic(this.platform.Characteristic.Name, zoneName)
        .setCharacteristic(this.platform.Characteristic.Active, this.platform.Characteristic.Active.INACTIVE)
        .setCharacteristic(this.platform.Characteristic.InUse, this.platform.Characteristic.InUse.NOT_IN_USE)
        .setCharacteristic(this.platform.Characteristic.ValveType, this.platform.Characteristic.ValveType.IRRIGATION)
        .setCharacteristic(this.platform.Characteristic.SetDuration, 300)
        .setCharacteristic(this.platform.Characteristic.RemainingDuration, 0)
        .setCharacteristic(this.platform.Characteristic.IsConfigured, this.platform.Characteristic.IsConfigured.CONFIGURED)
        .setCharacteristic(this.platform.Characteristic.ServiceLabelIndex, zone)
        .setCharacteristic(this.platform.Characteristic.StatusFault, this.platform.Characteristic.StatusFault.NO_FAULT);

      const valveZone = this.valveService.getCharacteristic(this.platform.Characteristic.ServiceLabelIndex).value as number;
      this.platform.log.debug('Configure Valve service for zone', valveZone);

      this.valveService
        .getCharacteristic(this.platform.Characteristic.Active)
        .onGet(() => {
          return this.rainbird!.isActive(valveZone)
            ? this.platform.Characteristic.Active.ACTIVE
            : this.platform.Characteristic.Active.INACTIVE;
        })
        .onSet(async (value) => {
          if (value === this.platform.Characteristic.Active.ACTIVE) {
            this.rainbird!.activateZone(valveZone);
          } else {
            await this.rainbird!.deactivateZone(valveZone);
          }
        });

      this.valveService
        .getCharacteristic(this.platform.Characteristic.InUse)
        .onGet(() => {
          return this.rainbird!.isInUse(valveZone)
            ? this.platform.Characteristic.InUse.IN_USE
            : this.platform.Characteristic.InUse.NOT_IN_USE;
        });

      this.valveService
        .getCharacteristic(this.platform.Characteristic.IsConfigured)
        .onGet(() => {
          return this.valveService.getCharacteristic(this.platform.Characteristic.IsConfigured).value;
        })
        .onSet((value) => {
          this.valveService.getCharacteristic(this.platform.Characteristic.IsConfigured).updateValue(value);
        });

      this.valveService
        .getCharacteristic(this.platform.Characteristic.StatusFault)
        .onGet(() => {
          return this.valveService.getCharacteristic(this.platform.Characteristic.StatusFault).value;
        });

      this.valveService
        .getCharacteristic(this.platform.Characteristic.ValveType)
        .onGet(() => {
          return this.valveService.getCharacteristic(this.platform.Characteristic.ValveType).value;
        });

      this.valveService
        .getCharacteristic(this.platform.Characteristic.SetDuration)
        .onGet(() => {
          return this.rainbird!.duration(valveZone);
        })
        .onSet((value) => {
          this.rainbird!.setDuration(valveZone, value as number);
        });

      this.valveService
        .getCharacteristic(this.platform.Characteristic.RemainingDuration)
        .onGet(() => {
          return this.rainbird!.durationRemaining(valveZone);
        });
    }
  }

  public updateValues(rainbird: RainBirdClient): void {
    this.platform.log.debug('Updating values');

    for (const accessory of this.platform.accessories) {
      for (const service of accessory.services) {
        if (service instanceof this.platform.Service.IrrigationSystem) {
          service
            .getCharacteristic(this.platform.Characteristic.Active)
            .updateValue(rainbird!.isActive() ? this.platform.Characteristic.Active.ACTIVE : this.platform.Characteristic.Active.INACTIVE);
          service
            .getCharacteristic(this.platform.Characteristic.InUse)
            .updateValue(rainbird!.isInUse() ? this.platform.Characteristic.InUse.IN_USE : this.platform.Characteristic.InUse.NOT_IN_USE);
          service
            .getCharacteristic(this.platform.Characteristic.RemainingDuration)
            .updateValue(rainbird!.durationRemaining());
        } else if (service instanceof this.platform.Service.Valve) {
          const zone = service.getCharacteristic(this.platform.Characteristic.ServiceLabelIndex).value as number;
          service
            .getCharacteristic(this.platform.Characteristic.Active)
            .updateValue(rainbird!.isActive(zone) ? this.platform.Characteristic.Active.ACTIVE : this.platform.Characteristic.Active.INACTIVE);
          service
            .getCharacteristic(this.platform.Characteristic.InUse)
            .updateValue(rainbird!.isInUse(zone) ? this.platform.Characteristic.InUse.IN_USE : this.platform.Characteristic.InUse.NOT_IN_USE);
          service
            .getCharacteristic(this.platform.Characteristic.RemainingDuration)
            .updateValue(rainbird!.durationRemaining(zone));
        }
      }
    }
  }
}
