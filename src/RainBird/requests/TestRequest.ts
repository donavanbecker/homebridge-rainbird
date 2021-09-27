import { Request } from './Request';

export class TestRequest extends Request {
  get type(): number {
    return 0x31;
  }

  toBuffer(): Buffer {
    return Buffer.from([this.type]);
  }
}