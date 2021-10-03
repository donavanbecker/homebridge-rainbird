import events = require('events');
import Queue from 'queue';
import { Logger } from 'homebridge';
import { RainBirdClient } from './RainBirdClient';
import { debounceTime, fromEvent, Subject, Subscription, timer } from 'rxjs';

type RainBirdMetaData = {
  model: string,
  version: string,
  serialNumber: string,
  zones: number[]
}

type ZoneStatus = {
  active: boolean,
  running: boolean,
  durationRemaining: number,
  durationTime?: Date
}

export class RainBirdService extends events.EventEmitter {
  private readonly log: Logger;
  private readonly _client: RainBirdClient;

  private _metadata: RainBirdMetaData = {
    model: 'Unknown',
    version: 'Unknown',
    serialNumber: 'Unknown',
    zones: [],
  }

  private _currentZoneId = 0;
  private _zones: Record<number, ZoneStatus> = {};
  private _rainSetPointReached = false;

  private _statusObsersable = fromEvent(this, 'status');
  private _statusTimerSubscription?: Subscription;
  private _statusRefreshSubject = new Subject<void>();

  private zoneQueue: Queue = new Queue({
    concurrency: 1,
    timeout: 3600000,
    autostart: true,
  });

  constructor(private readonly options: {
    address: string,
    password: string,
    refreshRate?: number,
    log: Logger
  }) {

    super();
    this.log = options.log;
    this._client = new RainBirdClient(options.address, options.password, options.log);

    this._statusRefreshSubject
      .pipe(
        debounceTime(1000),
      ).subscribe(async () => await this.performStatusRefresh());
  }

  async init(): Promise<RainBirdMetaData> {
    this.log.debug('Init');

    const respModelAndVersion = await this._client.getModelAndVersion();
    const respSerialNumber = await this._client.getSerialNumber();
    const respZones = await this._client.getAvailableZones();

    this._metadata = {
      model: respModelAndVersion.modelNumber,
      version: respModelAndVersion.version,
      serialNumber: respSerialNumber.serialNumber,
      zones: respZones.zones,
    };

    // Initialise zones
    for (const zone of respZones.zones) {
      this._zones[zone] = {
        active: false,
        running: false,
        durationRemaining: 0,
        durationTime: undefined,
      };
    }

    const irrigationState = (await this._client.getIrrigationState()).irrigationState;
    if (!irrigationState) {
      this.log.warn('RainBird controller is currently OFF. Please turn ON so plugin can control it');
    }

    const controllerDateTime = await this.getControllerDateTime();
    const timeDiff = controllerDateTime.getTime() - Date.now();
    if (Math.abs(timeDiff) > 300000) {
      const slowFast = timeDiff > 0 ? 'fast' : 'slow';
      this.log.warn(
        `RainBird clock [${controllerDateTime.toLocaleString()}] is more than 5 minutes ${slowFast}`,
      );
    }

    await this.updateStatus();

    this.setStatusTimer();

    return this._metadata;
  }

  get model(): string {
    return this._metadata.model;
  }

  get version(): string {
    return this._metadata.version;
  }

  get serialNumber(): string {
    return this._metadata.serialNumber;
  }

  get zones(): number[] {
    return this._metadata.zones;
  }

  get rainSetPointReached(): boolean {
    return this._rainSetPointReached;
  }

  isActive(zone?: number): boolean {
    return zone === undefined
      ? Object.values(this._zones).some((z) => z.active)
      : this._zones[zone].active;
  }

  isInUse(zone?: number): boolean {
    return zone === undefined
      ? Object.values(this._zones).some((z) => z.durationTime !== undefined)
      : this._zones[zone].durationTime !== undefined;
  }

  durationRemaining(zone?: number): number {
    if (zone === undefined) {
      let remaining = 0;
      for (const zone of this.zones) {
        remaining += this.calcDurationRemaining(zone);
      }
      return remaining;
    }
    return this.calcDurationRemaining(zone);
  }

  private calcDurationRemaining(zone: number): number {
    if (!this._zones[zone].active) {
      return 0;
    }
    const remaining = this._zones[zone].durationTime === undefined
      ? this._zones[zone].durationRemaining
      : this._zones[zone].durationRemaining - Math.round(
        ((new Date()).getTime() - this._zones[zone].durationTime!.getTime()) / 1000);

    return Math.max(remaining, 0);
  }

  activateZone(zone: number, duration: number): void {
    this.log.debug(`Zone ${zone}: Activate for ${duration} seconds`);

    this._zones[zone].active = true;
    this.zoneQueue.push(this.startZone.bind(this, zone, duration));
  }

  async deactivateZone(zone: number): Promise<void> {
    this.log.debug(`Zone ${zone}: Deactivate`);

    this._zones[zone].active = false;

    if (this.isInUse(zone)) {
      await this._client.advanceZone();
      this._statusRefreshSubject.next();
    }
  }

  private async startZone(zone: number, duration: number): Promise<void> {
    this.log.debug(`Zone ${zone}: Start for ${duration} seconds`);

    try {
      this._statusTimerSubscription?.unsubscribe();
      await this.updateStatus();

      if (!this.isActive(zone)) {
        this.log.info(`Zone ${zone}: Skipped as it is not active`);
        return;
      }

      if (this._currentZoneId !== 0) {
        this.setStatusTimer();

        let status: Subscription | undefined;

        await new Promise((resolve) => {
          status = this._statusObsersable.subscribe(() => {
            if (this._currentZoneId === 0) {
              resolve('');
            }
          });
        });
        status?.unsubscribe();
        this._statusTimerSubscription?.unsubscribe();
      }

      if (!this.isActive(zone)) {
        this.log.info(`Zone ${zone}: Skipped as it is not active`);
        return;
      }

      if (this.isInUse(zone)) {
        this.log.info(`Zone ${zone}: Skipped as it is already in use`);
        return;
      }

      this.log.info(`Zone ${zone}: Run for ${duration} seconds`);

      await this._client.runZone(zone, duration);

    } catch(error) {
      this.log.warn(`Zone ${zone}: Failed to start [${error}]`);
    } finally {
      this._statusRefreshSubject.next();
    }
  }

  private setStatusTimer(): void {
    this._statusTimerSubscription?.unsubscribe();

    let timerDuration = this.options.refreshRate ?? 0;
    if (this._currentZoneId !== 0) {
      const durationRemaining = this._zones[this._currentZoneId].durationRemaining;
      if (durationRemaining > 0) {
        timerDuration = timerDuration === 0
          ? durationRemaining
          : Math.min(timerDuration, durationRemaining);
      }
    }

    if (timerDuration > 0) {
      this.log.debug(`Status timer set for ${timerDuration} secs`);
      this._statusTimerSubscription = timer(timerDuration * 1000)
        .subscribe(async () => await this.performStatusRefresh());
    }
  }

  private async performStatusRefresh(): Promise<void> {
    try {
      this._statusTimerSubscription?.unsubscribe();
      await this.updateStatus();

      this.setStatusTimer();

    } catch (error) {
      this.log.debug(`Failed to get status: ${error}`);
    }
  }

  private async getControllerDateTime(): Promise<Date> {
    const respDate = await this._client.getControllerDate();
    const respTime = await this._client.getControllerTime();

    return new Date(
      respDate.year,
      respDate.month - 1,
      respDate.day,
      respTime.hour,
      respTime.minute,
      respTime.second,
    );
  }

  private async updateStatus(): Promise<void> {
    const currentZoneState = await this._client.getCurrentZoneState();
    const rainSensorState = await this._client.getRainSensorState();

    if (currentZoneState === undefined || rainSensorState === undefined) {
      return;
    }

    const previousZoneId = this._currentZoneId;
    this._currentZoneId = currentZoneState.zoneId;

    if (previousZoneId !== 0 && this._zones[previousZoneId].running && previousZoneId !== currentZoneState.zoneId) {
      this.log.info(`Zone ${previousZoneId}: Complete`);
    }

    for (const [id, zone] of Object.entries(this._zones)) {
      if (Number(id) === currentZoneState.zoneId && currentZoneState.running) {
        zone.active = true;
        zone.running = true;
        zone.durationRemaining = currentZoneState.timeRemaining;
        zone.durationTime = new Date();
        continue;
      }

      if (Number(id) === previousZoneId) {
        zone.active = false;
      }
      zone.running = false;
      zone.durationRemaining = 0;
      zone.durationTime = undefined;
    }

    this.emit('status');

    if (this._rainSetPointReached !== rainSensorState.setPointReached) {
      this._rainSetPointReached = rainSensorState.setPointReached;
      this.emit('rain_sensor_state');
      this.log.info(`Rain Sensor: ${rainSensorState.setPointReached ? 'SetPoint reached': 'Clear'}`);
    }
  }

  refreshStatus(): void {
    this._statusRefreshSubject.next();
  }
}