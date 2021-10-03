import { Response } from './Response';

export class RainSensorStateResponse extends Response {
  private readonly _setPointReached: boolean;

  constructor(private readonly response: Buffer) {
    super();
    this._setPointReached = response[1] !== 0;
  }

  get type(): number {
    return 0xBE;
  }

  get setPointReached(): boolean {
    return this._setPointReached;
  }

  toBuffer(): Buffer {
    return this.response;
  }
}