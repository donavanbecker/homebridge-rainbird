import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { RainbirdPlatform } from '../platform';
import { interval, Subject } from 'rxjs';
import { debounceTime, skipWhile, tap } from 'rxjs/operators';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class Valve {
  private service!: Service;
  fanService?: Service;
  humidityService?: Service;

  private modes: { Off: number; Heat: number; Cool: number; Auto: number };

  //Thermostat Characteristics
  CurrentTemperature!: CharacteristicValue;
  TargetTemperature!: CharacteristicValue;
  CurrentHeatingCoolingState!: CharacteristicValue;
  TargetHeatingCoolingState!: CharacteristicValue;
  CoolingThresholdTemperature!: CharacteristicValue;
  HeatingThresholdTemperature!: CharacteristicValue;
  CurrentRelativeHumidity?: CharacteristicValue;
  TemperatureDisplayUnits!: CharacteristicValue;
  //Fan Characteristics
  Active!: CharacteristicValue;
  InUse!: CharacteristicValue;
  //Modes
  honeywellMode!: Array<string>;
  fanMode;
  //Setpoints
  heatSetpoint!: number;
  coolSetpoint!: number;
  //T9 Only
  roompriority!: any;
  //Thermostat Updates
  valveUpdateInProgress!: boolean;
  doValveUpdate;
  //Fan Updates
  fanUpdateInProgress!: boolean;
  doFanUpdate;
  //Room updates - T9 Only
  roomUpdateInProgress!: boolean;
  doRoomUpdate;
  irrigationState: any;
  setActive: any;

  constructor(
    private readonly platform: RainbirdPlatform,
    private accessory: PlatformAccessory,
    public device,
  ) {
    // Map Honeywell Modes to HomeKit Modes
    this.modes = {
      Off: platform.Characteristic.TargetHeatingCoolingState.OFF,
      Heat: platform.Characteristic.TargetHeatingCoolingState.HEAT,
      Cool: platform.Characteristic.TargetHeatingCoolingState.COOL,
      Auto: platform.Characteristic.TargetHeatingCoolingState.AUTO,
    };

    // Map HomeKit Modes to Honeywell Modes
    // Don't change the order of these!
    this.honeywellMode = ['Off', 'Heat', 'Cool', 'Auto'];

    // default placeholders
    this.Active = this.platform.Characteristic.Active.INACTIVE;
    this.InUse = this.platform.Characteristic.InUse.IN_USE;

    // this is subject we use to track when we need to POST changes to the Honeywell API for Room Changes - T9 Only
    this.doRoomUpdate = new Subject();
    this.roomUpdateInProgress = false;
    // this is subject we use to track when we need to POST changes to the Honeywell API
    this.doValveUpdate = new Subject();
    this.valveUpdateInProgress = false;
    this.doFanUpdate = new Subject();
    this.fanUpdateInProgress = false;

    // set accessory information
    accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'RainBird')
      .setCharacteristic(this.platform.Characteristic.Model, device.deviceModel)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, device.deviceID)
      .setCharacteristic(this.platform.Characteristic.FirmwareRevision, accessory.context.firmwareRevision)
      .getCharacteristic(this.platform.Characteristic.FirmwareRevision).updateValue(accessory.context.firmwareRevision);

    //Thermostat Service
    (this.service =
      this.accessory.getService(this.platform.Service.Thermostat) ||
      this.accessory.addService(this.platform.Service.Thermostat)), accessory.displayName;

    //Service Name
    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.displayName);
    //Required Characteristics" see https://developers.homebridge.io/#/service/Thermostat

    //Initial Device Parse
    this.parseStatus();

    this.service.setCharacteristic(this.platform.Characteristic.ValveType, this.platform.Characteristic.ValveType.IRRIGATION);

    // Retrieve initial values and updateHomekit
    this.updateHomeKitCharacteristics();

    // Start an update interval
    interval(this.platform.config.options!.refreshRate! * 1000)
      .pipe(skipWhile(() => this.valveUpdateInProgress))
      .subscribe(() => {
        this.refreshStatus();
      });

    // Watch for valve change events
    // We put in a debounce of 100ms so we don't make duplicate calls
    this.doValveUpdate
      .pipe(
        tap(() => {
          this.valveUpdateInProgress = true;
        }),
        debounceTime(this.platform.config.options!.pushRate! * 1000),
      )
      .subscribe(async () => {
        try {
          await this.pushChanges();
        } catch (e) {
          this.platform.log.error(JSON.stringify(e.message));
          this.platform.log.debug('Thermostat %s -', this.accessory.displayName, JSON.stringify(e));
          this.apiError(e);
        }
        this.valveUpdateInProgress = false;
      });
  }

  /**
   * Parse the device status from the honeywell api
   */
  parseStatus() {
    if (this.device.units === 'Fahrenheit') {
      this.TemperatureDisplayUnits = this.platform.Characteristic.TemperatureDisplayUnits.FAHRENHEIT;
    }
    if (this.device.units === 'Celsius') {
      this.TemperatureDisplayUnits = this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS;
    }

    this.CurrentTemperature = this.device.indoorTemperature;

    if (this.device.indoorHumidity) {
      this.CurrentRelativeHumidity = this.device.indoorHumidity;
    }

    if (this.device.changeableValues.heatSetpoint > 0) {
      this.HeatingThresholdTemperature = this.device.changeableValues.heatSetpoint;
    }

    if (this.device.changeableValues.coolSetpoint > 0) {
      this.CoolingThresholdTemperature = this.device.changeableValues.coolSetpoint;
    }

    this.TargetHeatingCoolingState = this.modes[this.device.changeableValues.mode];

    /**
     * The CurrentHeatingCoolingState is either 'Heat', 'Cool', or 'Off'
     * CurrentHeatingCoolingState =  OFF = 0, HEAT = 1, COOL = 2
     */
    switch (this.device.operationStatus.mode) {
      case 'Heat':
        this.CurrentHeatingCoolingState = 1;
        break;
      case 'Cool':
        this.CurrentHeatingCoolingState = 2;
        break;
      default:
        this.CurrentHeatingCoolingState = 0;
    }
    this.platform.log.debug(
      'Thermostat %s Heat -',
      this.accessory.displayName,
      'Device is Currently: ',
      this.CurrentHeatingCoolingState,
    );
  }

  /**
   * Asks the Honeywell Home API for the latest device information
   */
  async refreshStatus() {
    try {
      this.irrigationState = this.device.getIrrigationState();
      this.platform.log.debug(
        'Thermostat %s -',
        this.accessory.displayName,
        'Fetched update for',
        this.device.name,
        'from Honeywell API:',
        JSON.stringify(this.device.changeableValues),
      );
      this.parseStatus();
      this.updateHomeKitCharacteristics();
    } catch (e) {
      this.platform.log.error(
        'Thermostat - Failed to update status of',
        this.device.name,
        JSON.stringify(e.message),
        this.platform.log.debug('Thermostat %s -', this.accessory.displayName, JSON.stringify(e)),
      );
      this.apiError(e);
    }
  }

  /**
   * Pushes the requested changes to the Honeywell API
   */
  async pushChanges() {
    const payload = {} as any;

    // Only include mode on certain models
    switch (this.device.deviceModel) {
      case 'Unknown':
        break;
      default:
        payload.mode = this.honeywellMode[Number(this.TargetHeatingCoolingState)];
    }

    // Only include thermostatSetpointStatus on certain models
    switch (this.device.deviceModel) {
      case 'Round':
        this.platform.log.debug('thermostatSetpointStatus not sent for Round Thermostats');
        this.platform.log.debug(this.device.deviceModel);
        break;
      default:
        payload.thermostatSetpointStatus = true;
        this.platform.log.debug('Send thermostatSetpointStatus');
        this.platform.log.debug(this.device.deviceModel);
    }

    // Always set autoChangeoverActive to 'true' for Round Thermostats
    switch (this.device.deviceModel) {
      case 'Round':
      case 'D6':
        if (this.platform.debugMode) {
          this.platform.log.warn('Round/D6 set autoChangeoverActive');
          this.platform.log.warn(this.device.deviceModel);
        }
        payload.autoChangeoverActive = true;
        break;
      case 'Unknown':
        if (this.platform.debugMode) {
          this.platform.log.warn('autoChangeoverActive not sent for Unknown Thermostats');
        }
        break;
      default:
        if (this.platform.debugMode) {
          this.platform.log.warn('set autoChangeoverActive');
          this.platform.log.warn(this.device.deviceModel);
        }
        payload.autoChangeoverActive = this.device.changeableValues.autoChangeoverActive;
    }

    switch (this.device.deviceModel) {
      case 'Unknown':
        this.platform.log.error(JSON.stringify(this.device));
        payload.thermostatSetpoint = this.TargetTemperature;
        switch (this.device.units) {
          case 'Fahrenheit':
            payload.unit = 'Fahrenheit';
            break;
          case 'Celsius':
            payload.unit = 'Celsius';
            break;
        }
        this.platform.log.info(
          'Sending request for',
          this.accessory.displayName,
          'to Honeywell API. thermostatSetpoint:',
          payload.thermostatSetpoint,
          'unit:',
          payload.unit,
          'thermostatSetpointStatus:',
          payload.thermostatSetpointStatus,
        );
        break;
      default:
        // Set the heat and cool set point value based on the selected mode
        switch (this.TargetHeatingCoolingState) {
          case this.platform.Characteristic.TargetHeatingCoolingState.HEAT:
            payload.heatSetpoint = this.TargetTemperature;
            payload.coolSetpoint = this.CoolingThresholdTemperature;
            break;
          case this.platform.Characteristic.TargetHeatingCoolingState.COOL:
            payload.coolSetpoint = this.TargetTemperature;
            payload.heatSetpoint = this.HeatingThresholdTemperature;
            break;
          case this.platform.Characteristic.TargetHeatingCoolingState.AUTO:
            payload.coolSetpoint = this.CoolingThresholdTemperature;
            payload.heatSetpoint = this.HeatingThresholdTemperature;
            break;
          default:
            payload.coolSetpoint = this.CoolingThresholdTemperature;
            payload.heatSetpoint = this.HeatingThresholdTemperature;
        }
        this.platform.log.info(
          'Sending request for',
          this.accessory.displayName,
          'to Honeywell API. mode:',
          payload.mode,
          'coolSetpoint:',
          payload.coolSetpoint,
          'heatSetpoint:',
          payload.heatSetpoint,
          'thermostatSetpointStatus:',
          payload.thermostatSetpointStatus,
        );
    }

    this.platform.log.debug('Thermostat %s pushChanges -', this.accessory.displayName, JSON.stringify(payload));
    // Make the API request

    // Refresh the status from the API
    await this.refreshStatus();
  }

  /**
   * Updates the status for each of the HomeKit Characteristics
   */
  updateHomeKitCharacteristics() {
    if (this.Active !== undefined) {
      this.service.updateCharacteristic(this.platform.Characteristic.Active, this.Active);
    }
    if (this.InUse !== undefined) {
      this.service.updateCharacteristic(this.platform.Characteristic.InUse, this.InUse);
    }
  }

  public apiError(e: any) {
    this.service.updateCharacteristic(this.platform.Characteristic.Active, e);
    this.service.updateCharacteristic(this.platform.Characteristic.InUse, e);
  }

  private setTargetHeatingCoolingState(value: CharacteristicValue) {
    this.platform.log.debug('Thermostat %s -', this.accessory.displayName, 'Set TargetHeatingCoolingState:', value);

    this.TargetHeatingCoolingState = value;

    // Set the TargetTemperature value based on the selected mode
    if (this.TargetHeatingCoolingState === this.platform.Characteristic.TargetHeatingCoolingState.HEAT) {
      this.TargetTemperature = this.device.changeableValues.heatSetpoint;
    } else {
      this.TargetTemperature = this.device.changeableValues.coolSetpoint;
    }
    this.service.updateCharacteristic(this.platform.Characteristic.TargetTemperature, this.TargetTemperature);
  }

  private setHeatingThresholdTemperature(value: CharacteristicValue) {
    this.platform.log.debug('Thermostat %s -', this.accessory.displayName, 'Set HeatingThresholdTemperature:', value);
    this.HeatingThresholdTemperature = value;
    this.doValveUpdate.next();
  }

  private setCoolingThresholdTemperature(value: CharacteristicValue) {
    this.platform.log.debug('Thermostat %s -', this.accessory.displayName, 'Set CoolingThresholdTemperature:', value);
    this.CoolingThresholdTemperature = value;
    this.doValveUpdate.next();
  }

  private setTargetTemperature(value: CharacteristicValue) {
    this.platform.log.debug('Thermostat %s -', this.accessory.displayName, 'Set TargetTemperature:', value);
    this.TargetTemperature = value;
    this.doValveUpdate.next();
  }

  private setTemperatureDisplayUnits(value: CharacteristicValue) {
    this.platform.log.debug('Thermostat %s -', this.accessory.displayName, 'Set TemperatureDisplayUnits:', value);
    this.platform.log.warn('Changing the Hardware Display Units from HomeKit is not supported.');

    // change the temp units back to the one the Honeywell API said the thermostat was set to
    setTimeout(() => {
      this.service.updateCharacteristic(
        this.platform.Characteristic.TemperatureDisplayUnits,
        this.TemperatureDisplayUnits,
      );
    }, 100);
  }
}
