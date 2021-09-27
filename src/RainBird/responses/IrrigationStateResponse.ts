import { Response } from './Response';

export class IrrigationStateResponse extends Response {
  private readonly _irrigationState: boolean;

  constructor(private readonly response: Buffer) {
    super();
    this._irrigationState = response[1] !== 0;
  }

  get type(): number {
    return 0xC8;
  }

  get irrigationState(): boolean {
    return this._irrigationState;
  }

  toBuffer(): Buffer {
    return this.response;
  }
}