import { Response } from './Response';

export class ProgramZoneStateResponse extends Response {
  private readonly _page: number;

  constructor(private readonly response: Buffer) {
    super();
    this._page = response[1];
  }

  get type(): number {
    return 0xBB;
  }

  get page(): number {
    return this._page;
  }

  toBuffer(): Buffer {
    return this.response;
  }
}