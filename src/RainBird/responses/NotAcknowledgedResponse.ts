import { Response } from './Response';

export class NotAcknowledgedResponse extends Response {
  private readonly _commandType: number;
  private readonly _code: number;

  constructor(private readonly response: Buffer) {
    super();
    this._commandType = response[1];
    this._code = response[2];
  }

  get type(): number {
    return 0x01;
  }

  get commandType(): number {
    return this._commandType;
  }

  get code(): number {
    return this._code;
  }

  toBuffer(): Buffer {
    return this.response;
  }
}