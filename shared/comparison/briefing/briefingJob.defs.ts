// The browser-facing briefing protocol: the POST submission envelope and the socket snapshot union. The comparison
// page imports this module, so it stays on `effect`'s Schema and public types only. No envelope may carry the evidence
// packet, the prompt, or a provider credential.

import { Schema } from 'effect';

import { AvailablePackageBriefingSchema } from './briefing.defs';
import type { AvailablePackageBriefing, BriefingUnavailableReason } from './briefing.defs';

export type BriefingSubmission =
  | { status: 'available'; packageName: string; from: string; to: string; briefing: AvailablePackageBriefing }
  | {
      status: 'queued' | 'running';
      packageName: string;
      from: string;
      to: string;
      hash: string;
      eventsUrl: string;
      revision: number;
    };

export type BriefingJobEvent =
  | { status: 'queued' | 'running'; revision: number }
  | { status: 'available'; revision: number; briefing: AvailablePackageBriefing }
  | { status: 'unavailable'; revision: number; reason: BriefingUnavailableReason };

// The canonical briefing schemas are imported as values rather than mirrored: a runtime constraint added there (a URL
// or length bound, say) has to keep applying to these socket-decoded, browser-facing envelopes.
const UnavailableReasonSchema: Schema.Codec<BriefingUnavailableReason> = Schema.Literals([
  'not-configured',
  'invalid-config',
  'provider-error',
  'cache-error',
  'timeout',
  'invalid-response',
]);

const BriefingJobEventSchema: Schema.Codec<BriefingJobEvent> = Schema.Union([
  Schema.Struct({ status: Schema.Literals(['queued', 'running']), revision: Schema.Natural }),
  Schema.Struct({
    status: Schema.Literal('available'),
    revision: Schema.Natural,
    briefing: AvailablePackageBriefingSchema,
  }),
  Schema.Struct({ status: Schema.Literal('unavailable'), revision: Schema.Natural, reason: UnavailableReasonSchema }),
]);

// Revisions are non-negative integers, and a smuggled packet, prompt, credential, or provider body is an error rather
// than an ignored key: the browser only ever renders what the envelope declares.
export const decodeBriefingJobEvent = Schema.decodeUnknownSync(BriefingJobEventSchema, {
  errors: 'all',
  onExcessProperty: 'error',
});

const NonBlankStringSchema = Schema.String.check(
  Schema.isMinLength(1),
  Schema.makeFilter((value) => value.trim() !== '', { expected: 'a nonblank string' }),
);

// The hash is the evidence digest the D1 key and the socket path are built from, so a submission cannot name a job
// that belongs to other evidence.
const HashSchema = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{64}$/, { expected: '64 lowercase hexadecimal characters' }),
);

const isWebSocketUrl = (value: string): boolean => {
  try {
    const { protocol } = new URL(value);

    return protocol === 'ws:' || protocol === 'wss:';
  } catch {
    return false;
  }
};

const WebSocketUrlSchema = Schema.String.check(
  Schema.makeFilter(isWebSocketUrl, { expected: 'a parseable ws: or wss: URL' }),
);

// The 200 (available) and 202 (pending) POST envelopes. Both are decoded strictly, so an envelope-level or nested
// packet, prompt, credential, or raw provider error can never ride along into the page.
export const BriefingSubmissionSchema: Schema.Codec<BriefingSubmission> = Schema.Union([
  Schema.Struct({
    status: Schema.Literal('available'),
    packageName: NonBlankStringSchema,
    from: NonBlankStringSchema,
    to: NonBlankStringSchema,
    briefing: AvailablePackageBriefingSchema,
  }),
  Schema.Struct({
    status: Schema.Literals(['queued', 'running']),
    packageName: NonBlankStringSchema,
    from: NonBlankStringSchema,
    to: NonBlankStringSchema,
    hash: HashSchema,
    eventsUrl: WebSocketUrlSchema,
    revision: Schema.Natural,
  }),
]);

export const decodeBriefingSubmission = Schema.decodeUnknownSync(BriefingSubmissionSchema, {
  errors: 'all',
  onExcessProperty: 'error',
});
