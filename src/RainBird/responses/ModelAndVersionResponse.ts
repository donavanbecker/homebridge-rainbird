import { Response } from './Response';

export class ModelAndVersionResponse extends Response {
  private readonly _modelNumber: number;
  private readonly _version: string;

  constructor(private readonly response: Buffer) {
    super();
    this._modelNumber = response.readUInt16BE(1);
    this._version = `${response[3]}.${response[4]}`;
  }

  get type(): number {
    return 0x82;
  }

  get modelNumber(): string {
    switch (this._modelNumber) {
      case 0x0003:
        return 'ESP-RZXe';
      case 0x0007:
        return 'ESP-Me';
      case 0x0009:
        return 'ESP-ME3';
      case 0x010A:
        return 'ESP-TM2';
      default:
        return this._modelNumber.toString();
    }
  }

  get version(): string {
    return this._version;
  }

  toBuffer(): Buffer {
    return this.response;
  }
}