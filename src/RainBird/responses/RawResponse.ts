import { Response } from './Response';

export class RawResponse extends Response {

  constructor(private readonly response: Buffer) {
    super();
  }

  get type(): number {
    return this.response[0];
  }

  get page(): number {
    return this.response[1];
  }

  toBuffer(): Buffer {
    return this.response;
  }
}