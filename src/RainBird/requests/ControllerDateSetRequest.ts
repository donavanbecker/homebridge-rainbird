import { Request } from './Request';

export class ControllerDateSetRequest extends Request {
  private _day = 0;
  private _month = 0;
  private _year = 0;

  constructor(day: number, month: number, year: number) {
    super();
    this._day = day;
    this._month = month;
    this._year = year;
  }

  get type(): number {
    return 0x13;
  }

  get day(): number {
    return this._day;
  }

  set day(value: number) {
    this._day = value;
  }

  get month(): number {
    return this._month;
  }

  set month(value: number) {
    this._month = value;
  }

  get year(): number {
    return this._year;
  }

  set year(value: number) {
    this._year = value;
  }

  toBuffer(): Buffer {
    const monthYear = Buffer.alloc(2);
    monthYear.writeUInt16BE(this.month * 4096 + this.year);
    return Buffer.concat([Buffer.from([this.type, this.day]), monthYear]);
  }
}
