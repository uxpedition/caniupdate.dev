import { describe, expect, it } from 'vitest';

import type { AvailablePackageBriefing, BriefingUnavailableReason } from './briefing.defs';
import { decodeBriefingJobEvent, decodeBriefingSubmission } from './briefingJob.defs';
import type { BriefingJobEvent, BriefingSubmission } from './briefingJob.defs';

const HASH = 'b637f83283a13491f7fee3cd9a108ab6ea20994d00a95a6646ba7a1bd48818b4';
const EVENTS_URL = `wss://briefing.example/api/briefings/${HASH}/events`;

// Every terminal reason the socket may carry. The wire literals cannot drift from `BriefingUnavailableReason` in
// either direction: `satisfies Record<…, true>` rejects a missing key (the canonical union gains a literal), and the
// excess-property check on this fresh object literal rejects an extra key (the canonical union loses a literal). The
// annotated reason schema in the module under test guards neither direction — `Schema.Codec` is covariant, so a
// narrower literal list satisfies it.
const TERMINAL_REASONS = {
  'not-configured': true,
  'invalid-config': true,
  'provider-error': true,
  'cache-error': true,
  timeout: true,
  'invalid-response': true,
} satisfies Record<BriefingUnavailableReason, true>;

const briefing = (): AvailablePackageBriefing => ({
  status: 'available',
  model: 'test-model',
  bullets: [
    {
      kind: 'migration',
      basis: 'inference',
      text: 'The target declares Node >=20; update Node 18 runtimes before upgrading.',
      evidenceIds: ['comparison.node'],
    },
  ],
  sources: [
    {
      id: 'comparison.node',
      kind: 'fact',
      label: 'Computed Node engine declaration comparison',
      urls: ['https://registry.npmjs.org/minimist/1.2.8'],
      text: JSON.stringify({ changed: true, from: '>=14', to: '>=20' }),
    },
  ],
});

describe('decodeBriefingJobEvent', () => {
  it('decodes the queued, running, and available socket envelopes exactly', () => {
    const queued: BriefingJobEvent = { status: 'queued', revision: 0 };
    const running: BriefingJobEvent = { status: 'running', revision: 3 };
    const available: BriefingJobEvent = { status: 'available', revision: 7, briefing: briefing() };

    expect(decodeBriefingJobEvent(queued)).toEqual(queued);
    expect(decodeBriefingJobEvent(running)).toEqual(running);
    expect(decodeBriefingJobEvent(available)).toEqual(available);
  });

  it.each(Object.keys(TERMINAL_REASONS))('decodes the terminal %s envelope', (reason) => {
    expect(decodeBriefingJobEvent({ status: 'unavailable', revision: 2, reason })).toEqual({
      status: 'unavailable',
      revision: 2,
      reason,
    });
  });

  it.each([
    ['the evidence packet', { status: 'queued', revision: 1, packet: { packageName: 'minimist' } }],
    ['the prompt', { status: 'running', revision: 1, prompt: 'You are a release analyst.' }],
    ['a provider credential', { status: 'unavailable', revision: 1, reason: 'timeout', apiKey: 'sk-fixture' }],
    ['a raw provider error', { status: 'available', revision: 1, briefing: briefing(), providerError: 'raw body' }],
  ] as const)('rejects an envelope smuggling %s', (_label, envelope) => {
    expect(() => decodeBriefingJobEvent(envelope)).toThrow();
  });

  it('rejects a briefing snapshot that carries the evidence packet', () => {
    const leaked = { ...briefing(), packet: { packageName: 'minimist' } };

    expect(() => decodeBriefingJobEvent({ status: 'available', revision: 1, briefing: leaked })).toThrow();
  });

  it.each([
    { status: 'queued', revision: -1 },
    { status: 'queued', revision: 1.5 },
    { status: 'queued', revision: '1' },
    { status: 'queued' },
    { status: 'done', revision: 1 },
    { status: 'unavailable', revision: 1, reason: 'unknown-reason' },
  ])('rejects the invalid envelope %o', (envelope) => {
    expect(() => decodeBriefingJobEvent(envelope)).toThrow();
  });

  it.each([undefined, null, 'queued', 42, []])('rejects the non-envelope %o', (value) => {
    expect(() => decodeBriefingJobEvent(value)).toThrow();
  });
});

describe('decodeBriefingSubmission', () => {
  // These literals are the POST wire contract the comparison page consumes; a renamed field or a new required field
  // fails compilation here, and the JSON round trip rejects a value that cannot cross the service boundary.
  it('decodes the 200 available envelope exactly', () => {
    const submission: BriefingSubmission = {
      status: 'available',
      packageName: 'minimist',
      from: '1.2.0',
      to: '1.2.8',
      briefing: briefing(),
    };

    expect(decodeBriefingSubmission(submission)).toEqual(submission);
    expect(JSON.parse(JSON.stringify(submission))).toEqual(submission);
  });

  it('decodes the 202 queued and running envelopes exactly', () => {
    const queued: BriefingSubmission = {
      status: 'queued',
      packageName: 'minimist',
      from: '1.2.0',
      to: '1.2.8',
      hash: HASH,
      eventsUrl: EVENTS_URL,
      revision: 0,
    };
    const running: BriefingSubmission = {
      status: 'running',
      packageName: 'minimist',
      from: '1.2.0',
      to: '1.2.8',
      hash: HASH,
      eventsUrl: EVENTS_URL,
      revision: 4,
    };

    expect(decodeBriefingSubmission(queued)).toEqual(queued);
    expect(decodeBriefingSubmission(running)).toEqual(running);
    expect(JSON.parse(JSON.stringify(running))).toEqual(running);
  });

  it.each([
    ['a short hash', { hash: HASH.slice(0, 63) }],
    ['an uppercase hash', { hash: HASH.toUpperCase() }],
    ['a non-hex hash', { hash: 'z'.repeat(64) }],
    ['a non-string hash', { hash: 1 }],
    ['a missing hash', { hash: undefined }],
    ['a relative events URL', { eventsUrl: `/api/briefings/${HASH}/events` }],
    ['an https events URL', { eventsUrl: `https://briefing.example/api/briefings/${HASH}/events` }],
    ['an unparseable events URL', { eventsUrl: 'wss://briefing example/events' }],
    ['a negative revision', { revision: -1 }],
    ['a fractional revision', { revision: 1.5 }],
    ['a missing revision', { revision: undefined }],
    ['a blank package name', { packageName: '   ' }],
    ['a blank from version', { from: '' }],
    ['a blank to version', { to: ' ' }],
  ] as const)('rejects a pending envelope with %s', (_label, override) => {
    const pending = {
      status: 'queued',
      packageName: 'minimist',
      from: '1.2.0',
      to: '1.2.8',
      hash: HASH,
      eventsUrl: EVENTS_URL,
      revision: 0,
    };

    expect(() => decodeBriefingSubmission({ ...pending, ...override })).toThrow();
  });

  it.each([
    ['an envelope-level packet', { packet: { packageName: 'minimist' } }],
    ['an envelope-level credential', { apiKey: 'sk-fixture' }],
    ['an envelope-level prompt', { prompt: 'You are a release analyst.' }],
    ['an envelope-level provider error', { providerError: 'raw body' }],
    ['a nested packet in the briefing', { briefing: { ...briefing(), packet: { packageName: 'minimist' } } }],
    [
      'a nested provider body in a briefing bullet',
      { briefing: { ...briefing(), bullets: [{ ...briefing().bullets[0], rawBody: '{"choices":[]}' }] } },
    ],
    [
      'a nested credential on a briefing source',
      { briefing: { ...briefing(), sources: [{ ...briefing().sources[0], apiKey: 'sk-fixture' }] } },
    ],
  ] as const)('rejects %s', (_label, override) => {
    const available = {
      status: 'available',
      packageName: 'minimist',
      from: '1.2.0',
      to: '1.2.8',
      briefing: briefing(),
    };

    expect(() => decodeBriefingSubmission({ ...available, ...override })).toThrow();
  });

  it.each([undefined, null, 'queued', 42, []])('rejects the non-envelope %o', (value) => {
    expect(() => decodeBriefingSubmission(value)).toThrow();
  });

  it('cannot carry the evidence packet or a provider credential', () => {
    const pending: BriefingSubmission = {
      status: 'queued',
      packageName: 'minimist',
      from: '1.2.0',
      to: '1.2.8',
      hash: HASH,
      eventsUrl: EVENTS_URL,
      revision: 0,
    };
    // The type alone forbids both smuggled fields and the decoder rejects the value that carries them anyway.
    // @ts-expect-error a browser-facing submission may not carry the bounded evidence packet
    const withPacket: BriefingSubmission = { ...pending, packet: { packageName: 'minimist' } };
    // @ts-expect-error a browser-facing submission may not carry the provider credential
    const withCredential: BriefingSubmission = { ...pending, apiKey: 'sk-fixture' };

    expect(() => decodeBriefingSubmission(withPacket)).toThrow();
    expect(() => decodeBriefingSubmission(withCredential)).toThrow();
  });
});
