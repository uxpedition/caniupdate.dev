import { describe, expect, it } from 'vitest';

import type { BriefingEvidence } from '#shared/comparison/briefing/briefing.defs';
import type {
  PackageEvidenceNamespace,
  PackageEvidenceResponse,
} from '#shared/comparison/evidence/packageEvidence.defs';

import { getBriefingEvidence, getPackageMeasurements } from './evidenceClient';

const request = { packageName: 'minimist', from: '1.0.0', to: '2.0.0' };

const evidence: BriefingEvidence = {
  packageName: 'minimist',
  from: '1.0.0',
  to: '2.0.0',
  sources: [
    {
      number: 1,
      id: 'comparison.node',
      kind: 'fact',
      label: 'Computed Node engine declaration comparison',
      urls: ['https://registry.npmjs.org/minimist/1.0.0', 'https://registry.npmjs.org/minimist/2.0.0'],
      text: JSON.stringify({ changed: true, from: '>=18', to: '>=20' }),
    },
  ],
  gaps: [],
};

// oxlint-disable-next-line rules/no-unknown-parameters -- Test response factory returning arbitrary JSON bodies; the client decodes every body.
const response = (value: unknown, status = 200): PackageEvidenceResponse => Response.json(value, { status });

const binding = (fetch: () => Promise<PackageEvidenceResponse>): PackageEvidenceNamespace => ({
  idFromName: () => ({}),
  get: () => ({ fetch: async () => await fetch() }),
});

describe('package evidence client failures', () => {
  it('distinguishes a missing binding from a malformed remote response', async () => {
    await expect(getBriefingEvidence(undefined, request)).rejects.toMatchObject({ reason: 'binding-unavailable' });
    await expect(
      getBriefingEvidence(
        binding(async () => response({})),
        request,
      ),
    ).rejects.toMatchObject({
      reason: 'protocol',
    });
  });

  it('distinguishes a binding transport failure from an upstream rejection', async () => {
    await expect(
      getBriefingEvidence(
        binding(async () => {
          throw new Error('private binding failed');
        }),
        request,
      ),
    ).rejects.toMatchObject({ reason: 'transport' });

    await expect(
      getBriefingEvidence(
        binding(async () => response({ error: 'private details' }, 429)),
        request,
      ),
    ).rejects.toMatchObject({ reason: 'upstream', statusCode: 429 });
  });

  it('classifies response-stream failures as transport for bounded and unbounded payloads', async () => {
    const responseWithBrokenBody: PackageEvidenceResponse = {
      ok: true,
      status: 200,
      headers: new Headers(),
      body: {
        cancel: async () => {},
        getReader: () => ({
          read: async () => {
            throw new Error('response stream failed');
          },
          cancel: async () => {},
          releaseLock: () => {},
        }),
      },
    };

    const bindingWithBrokenBody = binding(async () => responseWithBrokenBody);

    await expect(getBriefingEvidence(bindingWithBrokenBody, request)).rejects.toMatchObject({ reason: 'transport' });
    await expect(getPackageMeasurements(bindingWithBrokenBody, request)).rejects.toMatchObject({ reason: 'transport' });
  });

  it('classifies malformed JSON as a protocol failure', async () => {
    await expect(
      getBriefingEvidence(
        binding(async () => new Response('{')),
        request,
      ),
    ).rejects.toMatchObject({
      reason: 'protocol',
    });
    await expect(
      getPackageMeasurements(
        binding(async () => new Response('{')),
        request,
      ),
    ).rejects.toMatchObject({
      reason: 'protocol',
    });
  });

  it('returns validated evidence unchanged on a successful response', async () => {
    await expect(
      getBriefingEvidence(
        binding(async () => response(evidence)),
        request,
      ),
    ).resolves.toEqual(evidence);
  });
});
