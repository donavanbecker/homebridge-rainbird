import { Response } from './Response';

export class CurrentZoneResponse extends Response {
  private readonly _currentZone: number;

  constructor(private readonly response: Buffer) {
    super();
    this._currentZone = response[1];
  }

  get type(): number {
    return 0xBF;
  }

  get currentZone(): number {
    return this._currentZone;
  }

  toBuffer(): Buffer {
    return this.response;
  }
}