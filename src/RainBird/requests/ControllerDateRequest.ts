import { Request } from './Request';

export class ControllerDateRequest extends Request {
  get type(): number {
    return 0x12;
  }

  toBuffer(): Buffer {
    return Buffer.from([this.type]);
  }
}