import type { RateLimit } from '@cloudflare/workers-types';

import { decodeRateLimitCaller, type RateLimitCaller } from '../../shared/request/rateLimit.defs';
import { BriefingSubmissionError } from './jobState';

export const decodeSubmissionCaller = (caller: RateLimitCaller): RateLimitCaller => {
  try {
    return decodeRateLimitCaller(caller);
  } catch {
    throw new BriefingSubmissionError('invalid-response');
  }
};

/** Called only by the job acceptance lock, after stored/pending reuse. Never persist the caller. */
export const checkGenerationAllowance = async (limiter: RateLimit, caller: RateLimitCaller): Promise<void> => {
  let success: boolean;

  try {
    ({ success } = await limiter.limit(caller));
  } catch {
    throw new BriefingSubmissionError('provider-error');
  }

  if (!success) throw new BriefingSubmissionError('generation-rate-limited');
};
