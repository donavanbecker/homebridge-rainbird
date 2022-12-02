import { Response } from './Response';

export class CurrentZoneStateResponse extends Response {
  private readonly _page: number;
  private readonly _timeRemaining: number;
  private readonly _zoneId: number;
  private readonly _programNumber?: number;
  private readonly _running: boolean;
  private readonly _supported: boolean = true;

  constructor(private readonly response: Buffer) {
    super();
    this._page = response[1];

    switch (response.length) {
      case 12: // ESP-TM2
        this._timeRemaining = response.readUInt16BE(4);
        this._zoneId = response[8];
        this._programNumber = response[9];
        this._running = response[11] !== 0;
        break;
      case 10: // ESP-RZXe & ESP-Me series
        this._timeRemaining = response.readUInt16BE(8);
        this._zoneId = response[6];
        this._programNumber = undefined;
        this._running = response[3] !== 0;
        break;
      case 7: // ESP-ME3 - page 0
        this._timeRemaining = response.readUInt16BE(8);
        this._zoneId = 0;
        this._programNumber = response[2];
        this._running = response[3] !== 0;
        break;
      case 6: // ESP-ME3 - page 1
        this._timeRemaining = response.readUInt16BE(4);
        this._zoneId = response[3];
        this._programNumber = undefined;
        this._running = false;
        break;
      default: // others
        this._timeRemaining = 0;
        this._zoneId = 0;
        this._programNumber = undefined;
        this._running = false;
        this._supported = false;
        break;
    }
  }

  get type(): number {
    return 0xBB;
  }

  get page(): number {
    return this._page;
  }

  get zoneId(): number {
    return this._zoneId;
  }

  get programNumber(): number | undefined {
    return this._programNumber;
  }

  get timeRemaining(): number {
    return this._timeRemaining;
  }

  get running(): boolean {
    return this._running;
  }

  get supported(): boolean {
    return this._supported;
  }

  toBuffer(): Buffer {
    return this.response;
  }
}