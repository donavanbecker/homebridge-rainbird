import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { RainbirdPlatform } from '../platform';
import { interval, Subject } from 'rxjs';
import { debounceTime, skipWhile, tap } from 'rxjs/operators';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class IrrigationSystem {
  private service!: Service;
  private valveService!: Service;

  //Irrigation Characteristics
  Active!: CharacteristicValue;
  InUse!: CharacteristicValue;
  ProgramMode!: CharacteristicValue;

  //Valve Characteristics
  ValveType!: CharacteristicValue;

  //Others
  getIrrigationState: any;
  getRainSensorState: any;
  getRainDelay: any;
  setActive: any;
  programNr: any;
  minutes: any;
  zone: any;
  days: any;
  On: any;

  //Irrigation Updates
  valveUpdateInProgress!: boolean;
  doValveUpdate;


  constructor(
    private readonly platform: RainbirdPlatform,
    private accessory: PlatformAccessory,
    public device,
  ) {
    // default placeholders
    this.Active = this.platform.Characteristic.Active.INACTIVE;
    this.InUse = this.platform.Characteristic.InUse.IN_USE;

    // this is subject we use to track when we need to POST changes to the Honeywell API
    this.doValveUpdate = new Subject();
    this.valveUpdateInProgress = false;

    // set accessory information
    accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'RainBird')
      .setCharacteristic(this.platform.Characteristic.Model, device.deviceModel)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, device.deviceID)
      .setCharacteristic(this.platform.Characteristic.FirmwareRevision, accessory.context.firmwareRevision)
      .getCharacteristic(this.platform.Characteristic.FirmwareRevision).updateValue(accessory.context.firmwareRevision);

    //Irrigation Service
    (this.service =
      this.accessory.getService(this.platform.Service.IrrigationSystem) ||
      this.accessory.addService(this.platform.Service.IrrigationSystem)), accessory.displayName;

    //Service Name
    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.displayName);
    //Required Characteristics" see https://developers.homebridge.io/#/service/Irrigation

    //Initial Device Parse
    this.parseStatus();

    // create handlers for required characteristics
    this.service.getCharacteristic(this.platform.Characteristic.Active)
      .onSet(this.ActiveSet.bind(this));

    //getAvailableZones
    //Returns the number of zones/stations for the controller. For ESP-RZXe this is always 3F000000 where 3F is binary 111111. Each bit is 1 zone.
    this.platform.log.debug(JSON.stringify(device.getAvailableZones()));
    this.platform.log.warn(JSON.stringify(device.getActiveZones()));
    const getActiveZones = device.getActiveZones();
    //const ActiveZones = JSON.parse(device.getActiveZones());
    //getActiveZones
    //Returns the decimal number of the currently active zone, or 0 when no zones are active.
    for (const activeZones of getActiveZones) {
      if (activeZones !== 0){
        this.platform.log.debug('Setting Up %s ', activeZones.devName, JSON.stringify(activeZones));
        (this.valveService = this.accessory.getService(activeZones.devName)
            || this.accessory.addService(this.platform.Service.Valve, activeZones.devName, activeZones.devName)), accessory.displayName;
        this.valveService.setCharacteristic(this.platform.Characteristic.Name, `${activeZones.devName} ${activeZones.deviceType}`);

        this.valveService.setCharacteristic(this.platform.Characteristic.ValveType, this.platform.Characteristic.ValveType.IRRIGATION);

        // each service must implement at-minimum the "required characteristics" for the given service type
        // see https://developers.homebridge.io/#/service/Outlet
        this.valveService
          .getCharacteristic(this.platform.Characteristic.On)
          .onSet(this.OnSet.bind(this));

        this.valveService.setCharacteristic(this.platform.Characteristic.OutletInUse, true);
      } else {
        this.platform.log.warn('No Zones Found');
      }
    }



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
        } catch (e: any) {
          this.platform.log.error(JSON.stringify(e.message));
          this.platform.log.debug('Irrigation %s -', this.accessory.displayName, JSON.stringify(e));
          this.apiError(e);
        }
        this.valveUpdateInProgress = false;
      });
  }

  /**
   * Parse the device status from the honeywell api
   */
  parseStatus() {
    this.platform.log.debug(
      'Irrigation %s -',
      this.accessory.displayName,
      'Device is Currently: ',
      this.device,
    );
  }

  /**
   * Asks the Honeywell Home API for the latest device information
   */
  async refreshStatus() {
    try {
    //getRainSensorState
    //Returns the state of the rain sensor (true or false)
      this.getRainSensorState = this.device.getRainSensorState();

      //getRainDelay
      //Returns the watering delay in days.
      this.getRainDelay = this.device.getRainDelay();

      //getIrrigationState
      //Returns if the controller is active or irrigation is switched off I think (boolean)
      this.getIrrigationState = this.device.getIrrigationState();
      this.platform.log.debug(
        'Irrigation %s - Fetched Update for Irrigation State: %s, Rain Delay: %s, Rain Sensor State: %',
        this.accessory.displayName,
        this.getIrrigationState,
        this.getRainDelay,
        this.getRainSensorState,
      );
      this.parseStatus();
      this.updateHomeKitCharacteristics();
    } catch (e: any) {
      this.platform.log.error(
        'Irrigation - Failed to update status of',
        this.device.name,
        JSON.stringify(e.message),
        this.platform.log.debug('Irrigation %s -', this.accessory.displayName, JSON.stringify(e)),
      );
      this.apiError(e);
    }
  }

  /**
   * Pushes the requested changes to the Honeywell API
   */
  async pushChanges() {

    if (!this.Active) {
    //stopIrrigation
    //Stops all irrigation
      this.device.stopIrrigation();


      //setRainDelay(days);
      //Sets the watering delay in days. Parse the delay as a decimal between 0 and 14
      this.device.setRainDelay(this.days);


      //startZone(zone, minutes);
      //Manually activates a zone for x minutes. When another zone is active, it will be de-activated.
      this.device.startZone(this.zone, this.minutes);

      //startAllZones(minutes);
      //Manually activates all zones in chronological order with x minutes.
      this.device.startAllZones(this.minutes);

      //startProgram(programNr);
      //Manually start program x. Not supported on ESP-RZXe but might work on other controllers
      this.device.startProgram(this.programNr);
    }
    this.platform.log.debug('%s pushChanges -', this.accessory.displayName, JSON.stringify(this.device));
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
    if (this.InUse !== undefined) {
      this.service.updateCharacteristic(this.platform.Characteristic.InUse, this.InUse);
    }
  }

  public apiError(e: any) {
    this.service.updateCharacteristic(this.platform.Characteristic.Active, e);
    this.service.updateCharacteristic(this.platform.Characteristic.InUse, e);
  }

  private OnSet(value: CharacteristicValue) {
    this.platform.log.debug('Irrigation %s -', this.accessory.displayName, 'Set HeatingThresholdTemperature:', value);
    this.On = value;
    this.doValveUpdate.next();
  }

  private ActiveSet(value: CharacteristicValue) {
    this.platform.log.debug('Irrigation %s -', this.accessory.displayName, 'Set CoolingThresholdTemperature:', value);
    this.Active = value;
    this.doValveUpdate.next();
  }
}
