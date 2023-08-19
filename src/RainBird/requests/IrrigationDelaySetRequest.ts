import { Request } from './Request';

export class IrrigationDelaySetRequest extends Request {
  private _days = 0;

  constructor(days: number) {
    super();
    this._days = days;
  }

  get type(): number {
    return 0x37;
  }

  get days(): number {
    return this._days;
  }

  set days(value: number) {
    this._days = value;
  }

  toBuffer(): Buffer {
    const days = Buffer.alloc(2);
    days.writeUInt16BE(this.days);
    return Buffer.concat([Buffer.from([this.type]), days]);
  }
}