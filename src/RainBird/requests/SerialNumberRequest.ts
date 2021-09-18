import { Request } from './Request';

export class SerialNumberRequest extends Request {
  get type(): number {
    return 0x05;
  }

  toBuffer(): Buffer {
    return Buffer.from([this.type]);
  }
}