import { Request } from './Request';

export class CurrentZoneStateRequest extends Request {
  private _page: number;

  constructor(page: number) {
    super();
    this._page = page;
  }

  get type(): number {
    return 0x3B;
  }

  get page(): number {
    return this._page;
  }

  toBuffer(): Buffer {
    return Buffer.from([this.type, this.page]);
  }
}