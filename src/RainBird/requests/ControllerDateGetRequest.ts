import { Request } from './Request';

export class ControllerDateGetRequest extends Request {
  get type(): number {
    return 0x12;
  }

  toBuffer(): Buffer {
    return Buffer.from([this.type]);
  }
}