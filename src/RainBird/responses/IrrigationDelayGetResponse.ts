import { Response } from './Response';

export class IrrigationDelayGetResponse extends Response {
  private readonly _days: number;

  constructor(private readonly response: Buffer) {
    super();
    this._days = response.readUInt16BE(1);
  }

  get type(): number {
    return 0xB6;
  }

  get days(): number {
    return this._days;
  }

  toBuffer(): Buffer {
    return this.response;
  }
}