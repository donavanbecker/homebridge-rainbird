import Queue from 'queue';
import events = require('events');
import { Logger } from 'homebridge';
import { RainBirdClient } from './RainBirdClient';
import { debounceTime, fromEvent, Subject, Subscription, timer } from 'rxjs';
import { ControllerStateResponse } from './responses/ControllerStateResponse';

type RainBirdMetaData = {
  model: string,
  version: string,
  serialNumber: string,
  zones: number[]
}

type RainBirdZone = {
  active: boolean,
  durationRemaining: number,
  durationTime?: Date
}

type RainBirdStatus = {
  controllerDateTime: Date;
  delayDays: number;
  rainSetPointReached: boolean;
  irrigationState: boolean;
  seasonalAdjust: number;
  zones: Record<number, RainBirdZone>;
  currentZone: number;
}

type ControllerStatus = {
  controllerDateTime: Date;
  delayDays: number;
  rainSetPointReached: boolean;
  irrigationState: boolean;
  seasonalAdjust: number;
  currentZone: number;
  currentZoneTimeRemaining: number;
}

export class RainBirdService extends events.EventEmitter {

  private readonly log: Logger;
  private readonly _client: RainBirdClient;
  private _supportsGetControllerState = true;

  private _metadata: RainBirdMetaData = {
    model: 'Unknown',
    version: 'Unknown',
    serialNumber: 'Unknown',
    zones: [],
  }

  private _status: RainBirdStatus = {
    controllerDateTime: new Date(),
    delayDays: 0,
    rainSetPointReached: false,
    irrigationState: false,
    seasonalAdjust: 0,
    zones: {},
    currentZone: 0,
  }

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
      this._status.zones[zone] = {
        active: false,
        durationRemaining: 0,
        durationTime: undefined,
      };
    }

    await this.updateStatus();

    if (!this._status!.irrigationState) {
      this.log.warn('RainBird controller is currently OFF. Please turn ON so plugin can control it');
    }

    const timeDiff = this._status!.controllerDateTime.getTime() - Date.now();
    if (Math.abs(timeDiff) > 300000) {
      const slowFast = timeDiff > 0 ? 'fast' : 'slow';
      this.log.warn(
        `RainBird controller time ${this._status!.controllerDateTime.toLocaleString()} is more than 5 minutes ${slowFast}`,
      );
    }

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
    return this._status.rainSetPointReached;
  }

  isActive(zone?: number): boolean {
    return zone === undefined
      ? Object.values(this._status!.zones).some((z) => z.active)
      : this._status!.zones[zone].active;
  }

  isInUse(zone?: number): boolean {
    return zone === undefined
      ? Object.values(this._status!.zones).some((z) => z.durationTime !== undefined)
      : this._status!.zones[zone].durationTime !== undefined;
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
    if (!this._status!.zones[zone].active) {
      return 0;
    }
    const remaining = this._status!.zones[zone].durationTime === undefined
      ? this._status!.zones[zone].durationRemaining
      : this._status!.zones[zone].durationRemaining - Math.round(
        ((new Date()).getTime() - this._status!.zones[zone].durationTime!.getTime()) / 1000);

    return Math.max(remaining, 0);
  }

  activateZone(zone: number, duration: number): void {
    this.log.debug(`Zone ${zone}: Activate for ${duration} seconds`);

    this._status!.zones[zone].active = true;
    this.zoneQueue.push(this.startZone.bind(this, zone, duration));
  }

  async deactivateZone(zone: number): Promise<void> {
    this.log.debug(`Zone ${zone}: Deactivate`);

    this._status!.zones[zone].active = false;

    if (this.isInUse(zone)) {
      await this._client.stopIrrigation();
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

      if (this._status.currentZone !== 0) {
        this.setStatusTimer();

        let status: Subscription | undefined;

        await new Promise((resolve) => {
          status = this._statusObsersable.subscribe(() => {
            if (this._status.currentZone === 0) {
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
    if (this._status!.currentZone !== 0) {
      const durationRemaining = this._status!.zones[this._status!.currentZone].durationRemaining;
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

  private async getControllerStatus(): Promise<ControllerStatus | undefined> {
    try {
      if (this._supportsGetControllerState) {
        const response = await this._client.getControllerState();

        if (response === undefined) {
          return;
        }

        if (response instanceof ControllerStateResponse) {
          return {
            controllerDateTime: response.controllerDateTime,
            delayDays: response.delayDays,
            rainSetPointReached: response.rainSetPointReached,
            irrigationState: response.irrigationState,
            seasonalAdjust: response.seasonalAdjust,
            currentZone: response.currentZone,
            currentZoneTimeRemaining: response.currentZoneTimeRemaining,
          };
        }
        this._supportsGetControllerState = false;
      }

      const respDate = await this._client.getControllerDate();
      const respTime = await this._client.getControllerTime();
      const respRainSetPointReached = await this._client.getRainSetPointReached();
      const respIrrigationState = await this._client.getIrrigationState();
      const respTimeRemaining = await this._client.getCurrentZoneTimeRemaining();

      if (respDate === undefined || respTime === undefined || respRainSetPointReached === undefined ||
        respIrrigationState === undefined || respTimeRemaining === undefined
      ) {
        return;
      }

      const controllerDateTime = new Date(
        respDate.year,
        respDate.month - 1,
        respDate.day,
        respTime.hour,
        respTime.minute,
        respTime.second,
      );

      return {
        controllerDateTime: controllerDateTime,
        delayDays: 0,
        rainSetPointReached: respRainSetPointReached.rainSetPointReached,
        irrigationState: respIrrigationState.irrigationState,
        seasonalAdjust: 0,
        currentZone: respTimeRemaining.currentZone,
        currentZoneTimeRemaining: respTimeRemaining.timeRemaining,
      };
    } catch (error) {
      this.log.debug(`Failed to get status: ${error}`);
    }
  }

  private async updateStatus(): Promise<void> {
    const status = await this.getControllerStatus();
    if (status === undefined) {
      this.log.warn('Unable to retrieve controller status');
      return;
    }

    const previousCurrentZone = this._status!.currentZone;

    this._status!.controllerDateTime = status.controllerDateTime;
    this._status!.delayDays = status.delayDays;
    this._status!.rainSetPointReached = status.rainSetPointReached;
    this._status!.irrigationState = status.irrigationState;
    this._status!.seasonalAdjust = status.seasonalAdjust;
    this._status!.currentZone = status.currentZone;

    if (previousCurrentZone > 0 && previousCurrentZone !== status.currentZone) {
      this.log.info(`Zone ${previousCurrentZone}: Complete`);
    }

    for (const [id, zone] of Object.entries(this._status!.zones)) {
      if (status.currentZone === 0 || status.currentZone !== Number(id)) {
        if (Number(id) === previousCurrentZone) {
          zone.active = false;
        }
        zone.durationRemaining = 0;
        zone.durationTime = undefined;
      } else {
        zone.active = true;
        zone.durationRemaining = status.currentZoneTimeRemaining;
        zone.durationTime = new Date();
      }
    }

    this.emit('status');
  }

  refreshStatus(): void {
    this._statusRefreshSubject.next();
  }
}