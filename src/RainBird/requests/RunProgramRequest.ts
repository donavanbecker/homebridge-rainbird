import { Request } from './Request';

// NOTE: program = 0 means program "A"

export class RunProgramRequest extends Request {
  private _program: number;

  constructor(program: number) {
    super();
    this._program = program;
  }

  get type(): number {
    return 0x38;
  }

  get program(): number {
    return this._program;
  }

  set program(value: number) {
    this._program = value;
  }

  toBuffer(): Buffer {
    return Buffer.from([this.type, this.program]);
  }
}