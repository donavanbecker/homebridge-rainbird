import { Response } from './Response';

export class ControllerStateResponse extends Response {
  private readonly _currentTime: Date;
  private readonly _delaySetting: number;
  private readonly _sensorState: number;
  private readonly _irrigationState: number;
  private readonly _seasonalAdjust: number;
  private readonly _remainingDuration: number;
  private readonly _activeZone: number;

  constructor(private readonly response: Buffer) {
    super();
    const monthYear = response.subarray(5, 6).toString('hex');
    const month = Number('0x0' + monthYear.substring(0, 0));
    const year = Number('0x0' + monthYear.substring(1, 3));

    this._currentTime = new Date(
      year,
      month,
      response[4],
      response[1],
      response[2],
      response[3],
    );
    this._delaySetting = response.readUInt16BE(7);
    this._sensorState = response[9];
    this._irrigationState = response[10];
    this._seasonalAdjust = response.readUInt16BE(11);
    this._remainingDuration = response.readUInt16BE(13);
    this._activeZone = response[15];
  }

  get type(): number {
    return 0xCC;
  }

  get currentTime(): Date {
    return this._currentTime;
  }

  get delaySetting(): number {
    return this._delaySetting;
  }

  get sensorState(): number {
    return this._sensorState;
  }

  get irrigationState(): number {
    return this._irrigationState;
  }

  get seasonalAdjust(): number {
    return this._seasonalAdjust;
  }

  get remainingDuration(): number {
    return this._remainingDuration;
  }

  get activeZone(): number {
    return this._activeZone;
  }

  toBuffer(): Buffer {
    return this.response;
  }
}