import { Request } from './Request';

export class RunZoneRequest extends Request {
  private _zone = 0;
  private _duration = 0;

  constructor(zone: number, duration: number) {
    super();
    this._zone = zone;
    this._duration = duration;
  }

  get type(): number {
    return 0x39;
  }

  get zone(): number {
    return this._zone;
  }

  set zone(value: number) {
    this._zone = value;
  }

  get duration(): number {
    return this._duration;
  }

  set duration(value: number) {
    this._duration = value;
  }

  toBuffer(): Buffer {
    const zone = Buffer.alloc(2);
    zone.writeUInt16BE(this.zone);
    return Buffer.concat([Buffer.from([this.type]), zone, Buffer.from([this.duration])]);
  }
}