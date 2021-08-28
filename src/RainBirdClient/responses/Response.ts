
export abstract class Response {
  abstract get type(): number;

  toString(): string {
    return `[${[...this.toBuffer().values()]}] [${this.constructor.name}]`;
  }

  abstract toBuffer(): Buffer;
}