import { Request } from './Request';

export class CurrentZoneRequest extends Request {
  get type(): number {
    return 0x3F;
  }

  get page(): number {
    return 0x00;
  }

  toBuffer(): Buffer {
    return Buffer.from([this.type, this.page]);
  }
}