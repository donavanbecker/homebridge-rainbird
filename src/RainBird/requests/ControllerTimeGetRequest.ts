import { Request } from './Request';

export class ControllerTimeGetRequest extends Request {
  get type(): number {
    return 0x10;
  }

  toBuffer(): Buffer {
    return Buffer.from([this.type]);
  }
}