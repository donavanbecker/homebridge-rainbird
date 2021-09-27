import { Response } from './Response';

export class ControllerStateResponse extends Response {
  private readonly _controllerDateTime: Date;
  private readonly _delayDays: number;
  private readonly _rainSetPointReached: boolean;
  private readonly _irrigationState: boolean;
  private readonly _seasonalAdjust: number;
  private readonly _currentZoneTimeRemaining: number;
  private readonly _currentZone: number;

  constructor(private readonly response: Buffer) {
    super();
    const monthYear = response.subarray(5, 7).toString('hex');
    const month = Number('0x0' + monthYear.substring(0, 1)) - 1;
    const year = Number('0x0' + monthYear.substring(1, 4));

    this._controllerDateTime = new Date(
      year,
      month,
      response[4],
      response[1],
      response[2],
      response[3],
    );
    this._delayDays = response.readUInt16BE(7);
    this._rainSetPointReached = response[9] !== 0;
    this._irrigationState = response[10] !== 0;
    this._seasonalAdjust = response.readUInt16BE(11);
    this._currentZoneTimeRemaining = response.readUInt16BE(13);
    this._currentZone = response[15];
  }

  get type(): number {
    return 0xCC;
  }

  get controllerDateTime(): Date {
    return this._controllerDateTime;
  }

  get delayDays(): number {
    return this._delayDays;
  }

  get rainSetPointReached(): boolean {
    return this._rainSetPointReached;
  }

  get irrigationState(): boolean {
    return this._irrigationState;
  }

  get seasonalAdjust(): number {
    return this._seasonalAdjust;
  }

  get currentZoneTimeRemaining(): number {
    return this._currentZoneTimeRemaining;
  }

  get currentZone(): number {
    return this._currentZone;
  }

  toBuffer(): Buffer {
    return this.response;
  }
}