import { Data } from 'effect';

export class SmokeFailure extends Data.TaggedError('SmokeFailure')<{
  readonly stage: string;
  readonly message: string;
}> {
  constructor(stage: string) {
    super({ stage, message: `Smoke failed at ${stage}` });
  }
}
