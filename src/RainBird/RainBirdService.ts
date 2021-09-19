import Queue from 'queue';
import events = require('events');
import { Logger } from 'homebridge';
import { RainBirdClient } from './RainBirdClient';
import { debounceTime, fromEvent, Subscription, timer } from 'rxjs';
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

export class RainBirdService extends events.EventEmitter {

  private readonly log: Logger;
  private readonly _client: RainBirdClient;

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

  private _statusTimerSubscription?: Subscription;
  private _statusRefreshSubscription: Subscription;

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

    this._statusRefreshSubscription = fromEvent(this, 'refresh_status')
      .pipe(
        debounceTime(500),
      ).subscribe(async () => await this.performStatusRefresh());
  }

  async init(): Promise<RainBirdMetaData> {
    this.log.debug('Init');

    const respModelAndVersion = await this._client.getModelAndVersion();
    const respSerialNumber = await this._client.getSerialNumber();
    const respZones = await this._client.getAvailableZones();
    const respState = await this._client.getControllerState();

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

    this.updateStatus(respState);

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
      this.emit('refresh_status');
    }
  }

  private async startZone(zone: number, duration: number): Promise<void> {
    this.log.debug(`Zone ${zone}: Start for ${duration} seconds`);

    try {
      this._statusTimerSubscription?.unsubscribe();
      const response = await this._client.getControllerState();
      this.updateStatus(response);

      if (!this.isActive(zone)) {
        this.log.info(`Zone ${zone}: Skipped as it is not active`);
        return;
      }

      if (this._status.currentZone !== 0) {
        this.setStatusTimer();
        await new Promise((resolve) => {
          this.on('status', () => {
            if (this._status.currentZone === 0) {
              resolve('');
            }
          });
        });
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
      this.emit('refresh_status');
    } catch (error) {
      this.log.warn(`Zone ${zone}: Failed to start [${error}]`);
      this.setStatusTimer();
    }
  }

  private setStatusTimer(): void {
    this.log.debug('setStatusTimer');

    this._statusTimerSubscription?.unsubscribe();

    let timerDuration = this.options.refreshRate ?? 0;
    if (this._status!.currentZone !== 0) {
      timerDuration = timerDuration === 0
        ? this._status!.zones[this._status!.currentZone].durationRemaining
        : Math.min(timerDuration, this._status!.zones[this._status!.currentZone].durationRemaining);
    }

    if (timerDuration > 0) {
      this.log.debug(`Status timer set for ${timerDuration} secs`);
      this._statusTimerSubscription = timer(timerDuration * 1000)
        .subscribe(async () => await this.performStatusRefresh());
    }
  }

  private async performStatusRefresh(): Promise<void> {
    this.log.debug('performStatusRefresh');

    try {
      this._statusTimerSubscription?.unsubscribe();
      const response = await this._client.getControllerState();
      this.updateStatus(response);

      this.setStatusTimer();

    } catch (error) {
      this.log.debug(`Failed to get status: ${error}`);
    }
  }

  private updateStatus(response: ControllerStateResponse): void {
    this.log.debug('updateStatus');

    const previousCurrentZone = this._status!.currentZone;

    this._status!.controllerDateTime = response.controllerDateTime;
    this._status!.delayDays = response.delayDays;
    this._status!.rainSetPointReached = response.rainSetPointReached;
    this._status!.irrigationState = response.irrigationState;
    this._status!.seasonalAdjust = response.seasonalAdjust;
    this._status!.currentZone = response.currentZone;

    if (previousCurrentZone > 0 && previousCurrentZone !== response.currentZone) {
      this.log.info(`Zone ${previousCurrentZone}: Complete`);
    }

    for (const [id, zone] of Object.entries(this._status!.zones)) {
      if (response.currentZone === 0 || response.currentZone !== Number(id)) {
        if (Number(id) === previousCurrentZone) {
          zone.active = false;
        }
        zone.durationRemaining = 0;
        zone.durationTime = undefined;
      } else {
        zone.active = true;
        zone.durationRemaining = response.currentZoneTimeRemaining;
        zone.durationTime = new Date();
      }
    }

    this.emit('status');
  }

  refreshStatus(): void {
    this.emit('refresh_status');
  }
}