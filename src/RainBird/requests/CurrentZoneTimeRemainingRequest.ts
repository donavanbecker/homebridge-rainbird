import { Request } from './Request';

export class CurrentZoneTimeRemainingRequest extends Request {
  get type(): number {
    return 0x3B;
  }

  get page(): number {
    return 0x00;
  }

  toBuffer(): Buffer {
    return Buffer.from([this.type, this.page]);
  }
}