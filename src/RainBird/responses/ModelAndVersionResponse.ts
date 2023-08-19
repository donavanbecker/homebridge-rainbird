import { Response } from './Response';

export class ModelAndVersionResponse extends Response {
  private readonly _modelNumber: number;
  private readonly _version: string;

  private readonly _models: Map<number, string> = new Map([
    [0x0003, 'ESP-RZXe'],
    [0x0005, 'ESP-TM2'],
    [0x0006, 'ST8x-WiFi'],
    [0x0007, 'ESP-Me'],
    [0x0008, 'ST8x-WiFi2'],
    [0x0009, 'ESP-ME3'],
    [0x000A, 'ESP-TM2'],
    [0x0010, 'ESP-Me2'],
    [0x0099, 'TBOS-BT'],
    [0x0103, 'ESP-RZXe2'],
    [0x0107, 'ESP-Me'],
    [0x010A, 'ESP-TM2'],
    [0x0812, 'ARC8'],
  ]);

  constructor(private readonly response: Buffer) {
    super();
    this._modelNumber = response.readUInt16BE(1);
    this._version = `${response[3]}.${response[4]}`;
  }

  get type(): number {
    return 0x82;
  }

  get modelNumber(): number {
    return this._modelNumber;
  }

  get modelName(): string {
    return this._models.get(this._modelNumber) ?? this._modelNumber.toString();
  }

  get version(): string {
    return this._version;
  }

  toBuffer(): Buffer {
    return this.response;
  }
}