import { Response } from './Response';

export class AvailableZonesResponse extends Response {
  private readonly _page: number;
  private readonly _zones: number[] = [];

  constructor(private readonly response: Buffer) {
    super();

    this._page = response[1];
    let zones = response.readUInt32LE(2);
    for (let i = 0; i < 32; i++) {
      if ((zones & 1) === 1) {
        this._zones.push(i + 1);
      }
      zones = zones >>> 1;
    }
  }

  get type(): number {
    return 0x83;
  }

  get page(): number {
    return this._page;
  }

  get zones(): number[] {
    return this._zones;
  }

  toBuffer(): Buffer {
    return this.response;
  }

}