import { Request } from './Request';

export class RawRequest extends Request {
  private _type: number;
  private _page: number;

  constructor(type: number, page: number) {
    super();
    this._type = type;
    this._page = page;
  }

  get type(): number {
    return this._type;
  }

  get page(): number {
    return this._page;
  }

  toBuffer(): Buffer {
    return Buffer.from([this.type, this.page]);
  }
}