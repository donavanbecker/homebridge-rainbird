import { Response } from './Response';

export class CurrentZoneTimeRemainingResponse extends Response {
  private readonly _page: number;
  private readonly _timeRemaining: number;
  private readonly _currentZone: number;
  private readonly _running: boolean;

  constructor(private readonly response: Buffer) {
    super();
    this._page = response[1];

    if (response.length === 12) {
      this._timeRemaining = response.readUInt16BE(4);
      this._currentZone = response[8];
      this._running = response[11] !== 0;
    } else {
      this._timeRemaining = response.readUInt16BE(8);
      this._currentZone = response[6];
      this._running = response[3] !== 0;
    }
  }

  get type(): number {
    return 0xBB;
  }

  get page(): number {
    return this._page;
  }

  get currentZone(): number {
    return this._currentZone;
  }

  get timeRemaining(): number {
    return this._timeRemaining;
  }

  get runnning(): boolean {
    return this._running;
  }

  toBuffer(): Buffer {
    return this.response;
  }
}