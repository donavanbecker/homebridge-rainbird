import { Response } from './Response';

export class RainSetPointReachedResponse extends Response {
  private readonly _rainSetPointReached: boolean;

  constructor(private readonly response: Buffer) {
    super();
    this._rainSetPointReached = response[1] !== 0;
  }

  get type(): number {
    return 0xBE;
  }

  get rainSetPointReached(): boolean {
    return this._rainSetPointReached;
  }

  toBuffer(): Buffer {
    return this.response;
  }
}