import { Request } from './Request';

export class IrrigationStateRequest extends Request {
  get type(): number {
    return 0x48;
  }

  toBuffer(): Buffer {
    return Buffer.from([this.type]);
  }
}