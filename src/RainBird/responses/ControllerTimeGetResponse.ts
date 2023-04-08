import { Response } from './Response';

export class ControllerTimeGetResponse extends Response {
  private readonly _hour: number;
  private readonly _minute: number;
  private readonly _second: number;

  constructor(private readonly response: Buffer) {
    super();

    this._hour = response[1];
    this._minute = response[2];
    this._second = response[3];
  }

  get type(): number {
    return 0x90;
  }

  get hour(): number {
    return this._hour;
  }

  get minute(): number {
    return this._minute;
  }

  get second(): number {
    return this._second;
  }

  toBuffer(): Buffer {
    return this.response;
  }
}