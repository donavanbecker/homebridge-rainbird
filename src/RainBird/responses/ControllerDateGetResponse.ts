import { Response } from './Response';

export class ControllerDateGetResponse extends Response {
  private readonly _year: number;
  private readonly _month: number;
  private readonly _day: number;

  constructor(private readonly response: Buffer) {
    super();
    const monthYear = response.subarray(2, 4).toString('hex');
    this._year = Number('0x0' + monthYear.substring(1, 4));
    this._month = Number('0x0' + monthYear.substring(0, 1));
    this._day = response[1];
  }

  get type(): number {
    return 0x92;
  }

  get year(): number {
    return this._year;
  }

  get month(): number {
    return this._month;
  }

  get day(): number {
    return this._day;
  }

  toBuffer(): Buffer {
    return this.response;
  }
}