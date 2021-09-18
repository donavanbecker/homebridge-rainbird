import { Request } from './Request';

export class StopIrrigationRequest extends Request {
  get type(): number {
    return 0x40;
  }

  toBuffer(): Buffer {
    return Buffer.from([this.type]);
  }
}