import { Response } from './Response';

export class CurrentZoneStateResponse extends Response {
  private readonly _page: number;
  private readonly _timeRemaining: number;
  private readonly _zoneId: number;
  private readonly _running: boolean;

  constructor(private readonly response: Buffer) {
    super();
    this._page = response[1];

    if (response.length === 12) {
      this._timeRemaining = response.readUInt16BE(4);
      this._zoneId = response[8];
      this._running = response[11] !== 0;
    } else {
      this._timeRemaining = response.readUInt16BE(8);
      this._zoneId = response[6];
      this._running = response[3] !== 0;
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

  get timeRemaining(): number {
    return this._timeRemaining;
  }

  get running(): boolean {
    return this._running;
  }

  toBuffer(): Buffer {
    return this.response;
  }
}