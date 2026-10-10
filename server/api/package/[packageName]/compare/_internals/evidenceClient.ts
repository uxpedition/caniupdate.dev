import { flow, Result, Schema } from 'effect';

import {
  BRIEFING_EVIDENCE_MAX_BYTES,
  BriefingEvidenceSchema,
  type BriefingEvidence,
} from '#shared/comparison/briefing/briefing.defs';
import type { PackageMeasurementsResponse } from '#shared/comparison/comparison.defs';
import type {
  PackageEvidenceBodyReadResult,
  PackageEvidenceBodyReader,
  PackageEvidenceNamespace,
  PackageEvidenceResponse,
  PackageEvidenceResponseBody,
} from '#shared/comparison/evidence/packageEvidence.defs';
import { isExactSemver } from '#shared/comparison/package/compareSemver';
import { PackageNameSchema } from '#shared/comparison/package/package.defs';

const VERSION_MAX_LENGTH = 256;

const VersionSchema = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(VERSION_MAX_LENGTH));

const EvidenceRequestSchema = Schema.Struct({
  packageName: PackageNameSchema,
  from: VersionSchema,
  to: VersionSchema,
});

export type PackageEvidenceRequest = typeof EvidenceRequestSchema.Type;

export type PackageEvidencePath = 'measurements' | 'briefing-evidence';

export type PackageEvidenceClientFailureReason = 'binding-unavailable' | 'transport' | 'upstream' | 'protocol';

/** Internal failure categories stay available to handlers; every category has the same sanitized public message. */
export class PackageEvidenceClientError extends Error {
  readonly code = 'PACKAGE_EVIDENCE_UNAVAILABLE';

  constructor(
    readonly reason: PackageEvidenceClientFailureReason,
    readonly statusCode?: number,
  ) {
    super('Package evidence service unavailable');
    this.name = 'PackageEvidenceClientError';
  }
}

export const decodePackageEvidenceRequest = (value: PackageEvidenceRequest): PackageEvidenceRequest => {
  try {
    return Schema.decodeUnknownSync(EvidenceRequestSchema)(value, { errors: 'all' });
  } catch {
    throw new PackageEvidenceClientError('protocol');
  }
};

export const decodeBriefingEvidence = flow(
  Schema.decodeUnknownResult(BriefingEvidenceSchema, { errors: 'all' }),
  (result): BriefingEvidence => {
    if (Result.isFailure(result)) throw new PackageEvidenceClientError('protocol');

    return result.success;
  },
);

const UnknownRecordSchema = Schema.Record(Schema.String, Schema.Unknown);

type UnknownRecord = typeof UnknownRecordSchema.Type;

const isRecord = Schema.is(UnknownRecordSchema);

const isScalarString = Schema.is(Schema.String);

const isCompactTarball = (value: unknown): value is UnknownRecord =>
  isRecord(value) && !Object.hasOwn(value, 'files') && !Object.hasOwn(value, 'changelogs');

const isCompactMeasuredVersion = (value: UnknownRecord, requested: string): boolean => {
  if (!isScalarString(value.version)) return false;

  if (isExactSemver(requested) && value.version !== requested) return false;

  return isCompactTarball(value.tarball);
};

// Measurement responses are produced by the typed backend collector. This boundary check only enforces the public
// envelope and the critical no-inventory contract; it deliberately does not duplicate every provider field schema.
const isCompactMeasurementsResponse = (
  value: unknown,
  request: PackageEvidenceRequest,
): value is PackageMeasurementsResponse => {
  if (!isRecord(value) || value.packageName !== request.packageName || !isRecord(value.comparison)) return false;
  const { from, to } = value;

  return (
    isRecord(from) &&
    isRecord(to) &&
    isCompactMeasuredVersion(from, request.from) &&
    isCompactMeasuredVersion(to, request.to)
  );
};

const cancelBody = async (response: PackageEvidenceResponse): Promise<void> => {
  try {
    await response.body?.cancel();
  } catch {
    // The original unavailable status is more useful than a cancellation failure.
  }
};

const hasAcceptableContentLength = (response: PackageEvidenceResponse, maxBytes: number): boolean => {
  const declaredLength = response.headers.get('content-length');

  if (declaredLength === null) return true;
  const length = Number(declaredLength);

  return Number.isFinite(length) && length >= 0 && length <= maxBytes;
};

const readBodyChunk = async (reader: PackageEvidenceBodyReader): Promise<Uint8Array | undefined> => {
  let result: PackageEvidenceBodyReadResult;

  try {
    result = await reader.read();
  } catch {
    throw new PackageEvidenceClientError('transport');
  }

  if (result.done) return undefined;

  if (!(result.value instanceof Uint8Array)) throw new PackageEvidenceClientError('protocol');

  return result.value;
};

const cancelReader = async (reader: PackageEvidenceBodyReader): Promise<void> => {
  try {
    await reader.cancel();
  } catch {
    // Preserve the sanitized client error even if the stream cancellation itself fails.
  }
};

const joinChunks = (chunks: readonly Uint8Array[], total: number): Uint8Array => {
  const bytes = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return bytes;
};

const readResponseBody = async (body: PackageEvidenceResponseBody, maxBytes?: number): Promise<Uint8Array> => {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const chunk = await readBodyChunk(reader);

      if (chunk === undefined) break;
      total += chunk.byteLength;

      if (maxBytes !== undefined && total > maxBytes) throw new PackageEvidenceClientError('protocol');
      chunks.push(chunk);
    }

    return joinChunks(chunks, total);
  } catch (cause) {
    await cancelReader(reader);
    throw cause;
  } finally {
    reader.releaseLock();
  }
};

// oxlint-disable-next-line rules/no-unknown-returns -- Parse step: JSON yields unknown by nature, and the protocol decoders consume it immediately.
const parseJson = (bytes: Uint8Array): unknown => {
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));

    return value;
  } catch {
    throw new PackageEvidenceClientError('protocol');
  }
};

// oxlint-disable-next-line rules/no-unknown-returns -- Parse step boundary; every consumer decodes through the evidence schemas immediately.
const readJson = async (response: PackageEvidenceResponse, maxBytes?: number): Promise<unknown> => {
  if (maxBytes !== undefined && !hasAcceptableContentLength(response, maxBytes)) {
    await cancelBody(response);
    throw new PackageEvidenceClientError('protocol');
  }

  const body = response.body;

  if (body === null) throw new PackageEvidenceClientError('protocol');

  return parseJson(await readResponseBody(body, maxBytes));
};

const requestEvidence = async (
  namespace: PackageEvidenceNamespace | undefined,
  path: PackageEvidencePath,
  rawRequest: PackageEvidenceRequest,
): Promise<{ readonly request: PackageEvidenceRequest; readonly value: unknown }> => {
  const request = decodePackageEvidenceRequest(rawRequest);

  if (namespace === undefined) throw new PackageEvidenceClientError('binding-unavailable');

  try {
    const objectId = namespace.idFromName(request.packageName);
    const object = namespace.get(objectId);

    const response = await object.fetch(`https://package-evidence/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      await cancelBody(response);
      throw new PackageEvidenceClientError('upstream', response.status);
    }

    const maxBytes = path === 'briefing-evidence' ? BRIEFING_EVIDENCE_MAX_BYTES : undefined;

    return { request, value: await readJson(response, maxBytes) };
  } catch (error) {
    if (error instanceof PackageEvidenceClientError) throw error;
    throw new PackageEvidenceClientError('transport');
  }
};

export async function getPackageMeasurements(
  namespace: PackageEvidenceNamespace | undefined,
  request: PackageEvidenceRequest,
): Promise<PackageMeasurementsResponse> {
  const { request: decodedRequest, value } = await requestEvidence(namespace, 'measurements', request);

  if (!isCompactMeasurementsResponse(value, decodedRequest)) throw new PackageEvidenceClientError('protocol');

  return value;
}

export async function getBriefingEvidence(
  namespace: PackageEvidenceNamespace | undefined,
  request: PackageEvidenceRequest,
): Promise<BriefingEvidence> {
  const { value } = await requestEvidence(namespace, 'briefing-evidence', request);
  const evidence = decodeBriefingEvidence(value);

  if (evidence.packageName !== request.packageName) throw new PackageEvidenceClientError('protocol');

  if (isExactSemver(request.from) && evidence.from !== request.from) throw new PackageEvidenceClientError('protocol');

  if (isExactSemver(request.to) && evidence.to !== request.to) throw new PackageEvidenceClientError('protocol');

  return evidence;
}
