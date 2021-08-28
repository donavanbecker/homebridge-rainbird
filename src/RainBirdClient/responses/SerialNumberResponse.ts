import { Response } from './Response';

export class SerialNumberResponse extends Response {
  private readonly _serialNumber: string;

  constructor(private readonly response: Buffer) {
    super();
    this._serialNumber = response.subarray(1, 8).toString('hex');
  }

  get type(): number {
    return 0x85;
  }

  get serialNumber(): string {
    return this._serialNumber;
  }

  toBuffer(): Buffer {
    return this.response;
  }
}