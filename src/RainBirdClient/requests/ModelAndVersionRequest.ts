import { Request } from './Request';

export class ModelAndVersionRequest extends Request {
  get type(): number {
    return 0x02;
  }

  toBuffer(): Buffer {
    return Buffer.from([this.type]);
  }
}