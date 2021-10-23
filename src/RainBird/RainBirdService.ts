import events = require('events');
import Queue from 'queue';
import { Logger } from 'homebridge';
import { RainBirdClient } from './RainBirdClient';
import { debounceTime, fromEvent, Subject, Subscription, timer } from 'rxjs';
import { AcknowledgedResponse } from './responses/AcknowledgedResponse';

type RainBirdMetaData = {
  model: string,
  version: string,
  serialNumber: string,
  zones: number[]
}

type ZoneStatus = {
  active: boolean,
  running: boolean,
  RemainingDuration: number,
  durationTime?: Date
}

type RainBirdStatus = {
  zoneId: number,
  timeRemaining: number,
  running: boolean,
  rainSensorSetPointReached: boolean
}

export class RainBirdService extends events.EventEmitter {
  private readonly log: Logger;
  private readonly _client: RainBirdClient;

  private _metadata: RainBirdMetaData = {
    model: 'Unknown',
    version: 'Unknown',
    serialNumber: 'Unknown',
    zones: [],
  };

  private _currentZoneStateSupported = true;
  private _advanceZoneSupported = true;
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
    const respCurrentZoneState = await this._client.getCurrentZoneState();

    this._currentZoneStateSupported = respCurrentZoneState.supported;

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
        RemainingDuration: 0,
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

  RemainingDuration(zone?: number): number {
    if (zone === undefined) {
      let remaining = 0;
      for (const zone of this.zones) {
        remaining += this.calcRemainingDuration(zone);
      }
      return remaining;
    }
    return this.calcRemainingDuration(zone);
  }

  private calcRemainingDuration(zone: number): number {
    if (!this._zones[zone].active) {
      return 0;
    }
    const remaining = this._zones[zone].durationTime === undefined
      ? this._zones[zone].RemainingDuration
      : this._zones[zone].RemainingDuration - Math.round(
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
      if (this._advanceZoneSupported) {
        const response = await this._client.advanceZone();
        this._advanceZoneSupported = response instanceof AcknowledgedResponse;
      }
      if (!this._advanceZoneSupported) {
        await this._client.stopIrrigation();
      }
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

      if (!this._currentZoneStateSupported) {
        this._zones[zone].RemainingDuration = duration;
        this._zones[zone].durationTime = new Date();
      }

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
      const RemainingDuration = this._zones[this._currentZoneId].RemainingDuration;
      if (RemainingDuration > 0) {
        timerDuration = timerDuration === 0
          ? RemainingDuration
          : Math.min(timerDuration, RemainingDuration);
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
    const status = await this.getRainBirdStatus();

    if (status === undefined) {
      return;
    }

    const previousZoneId = this._currentZoneId;
    this._currentZoneId = status.zoneId;

    if (previousZoneId !== 0 && this._zones[previousZoneId].running && previousZoneId !== status.zoneId) {
      this.log.info(`Zone ${previousZoneId}: Complete`);
    }

    for (const [id, zone] of Object.entries(this._zones)) {
      if (Number(id) === status.zoneId && status.running) {
        zone.active = true;
        zone.running = true;
        if (this._currentZoneStateSupported) {
          zone.RemainingDuration = status.timeRemaining;
          zone.durationTime = new Date();
        } else if (zone.durationTime === undefined) {
          zone.RemainingDuration = 0;
          zone.durationTime = new Date();
        }
        continue;
      }

      if (Number(id) === previousZoneId) {
        zone.active = false;
      }
      zone.running = false;
      zone.RemainingDuration = 0;
      zone.durationTime = undefined;
    }

    this.emit('status');

    if (this._rainSetPointReached !== status.rainSensorSetPointReached) {
      this._rainSetPointReached = status.rainSensorSetPointReached;
      this.emit('rain_sensor_state');
      this.log.info(`Rain Sensor: ${status.rainSensorSetPointReached ? 'SetPoint reached': 'Clear'}`);
    }
  }

  private async getRainBirdStatus(): Promise<RainBirdStatus | undefined> {
    const rainSensorState = await this._client.getRainSensorState();

    if (rainSensorState === undefined) {
      return undefined;
    }

    if (this._currentZoneStateSupported) {
      const currentZoneState = await this._client.getCurrentZoneState();

      if (currentZoneState === undefined) {
        return undefined;
      }

      return {
        zoneId: currentZoneState.zoneId,
        timeRemaining: currentZoneState.timeRemaining,
        running: currentZoneState.running,
        rainSensorSetPointReached: rainSensorState.setPointReached,
      };
    }

    const currentZone = await this._client.getCurrentZone();

    if (currentZone === undefined) {
      return undefined;
    }

    return {
      zoneId: currentZone.zoneId,
      timeRemaining: 0,
      running: true,
      rainSensorSetPointReached: rainSensorState.setPointReached,
    };
  }

  refreshStatus(): void {
    this._statusRefreshSubject.next();
  }
}