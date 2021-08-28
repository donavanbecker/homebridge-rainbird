import { Request } from './Request';

export class ControllerStateRequest extends Request {
  get type(): number {
    return 0x4B;
  }

  toBuffer(): Buffer {
    return Buffer.from([this.type]);
  }
}