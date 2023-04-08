import { Request } from './Request';

export class ControllerTimeSetRequest extends Request {
  private _hour = 0;
  private _minute = 0;
  private _second = 0;

  constructor(hour: number, minute: number, second: number) {
    super();
    this._hour = hour;
    this._minute = minute;
    this._second = second;
  }

  get type(): number {
    return 0x11;
  }

  get hour(): number {
    return this._hour;
  }

  set hour(value: number) {
    this._hour = value;
  }

  get minute(): number {
    return this._minute;
  }

  set minute(value: number) {
    this._minute = value;
  }

  get second(): number {
    return this._second;
  }

  set second(value: number) {
    this._second = value;
  }

  toBuffer(): Buffer {
    return Buffer.from([this.type, this.hour, this.minute, this.second]);
  }
}