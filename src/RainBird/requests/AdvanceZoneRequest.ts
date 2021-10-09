import { Request } from './Request';

export class AdvanceZoneRequest extends Request {
  get type(): number {
    return 0x42;
  }

  get page(): number {
    return 0x00;
  }

  toBuffer(): Buffer {
    return Buffer.from([this.type, this.page]);
  }
}