import { getResponseHeader, setResponseHeader } from 'h3';
import type { H3Event } from 'h3';

/** Defaults only: Nitro's error responder and route-specific stricter policies keep ownership. */
export const applyResponseSecurityPolicy = (event: H3Event): void => {
  if (getResponseHeader(event, 'x-content-type-options') === undefined) {
    setResponseHeader(event, 'X-Content-Type-Options', 'nosniff');
  }

  if (getResponseHeader(event, 'referrer-policy') === undefined) {
    setResponseHeader(event, 'Referrer-Policy', 'strict-origin-when-cross-origin');
  }
};
