import { Response } from './Response';

export class CurrentZoneResponse extends Response {
  private readonly _page: number;
  private readonly _currentZone: number;

  constructor(private readonly response: Buffer) {
    super();
    this._page = response[1];
    const currentZone = response.readUInt32LE(2);
    this._currentZone = currentZone === 0
      ? 0
      : Math.log2(response.readUInt32LE(2)) + 1;
  }

  get type(): number {
    return 0xBF;
  }

  get page(): number {
    return this._page;
  }

  get currentZone(): number {
    return this._currentZone;
  }

  toBuffer(): Buffer {
    return this.response;
  }
}