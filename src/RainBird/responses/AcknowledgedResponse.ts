import { Response } from './Response';

export class AcknowledgedResponse extends Response {
  private readonly _commandType: number;

  constructor(private readonly response: Buffer) {
    super();
    this._commandType = response[1];
  }

  get type(): number {
    return 0x01;
  }

  get commandType(): number {
    return this._commandType;
  }

  toBuffer(): Buffer {
    return this.response;
  }
}