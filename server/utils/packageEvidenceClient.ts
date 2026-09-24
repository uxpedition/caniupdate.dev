import { Schema } from 'effect';

import { BRIEFING_EVIDENCE_MAX_BYTES, BriefingEvidenceSchema, type BriefingEvidence } from '#shared/briefing.defs';
import { isExactSemver } from '#shared/compareSemver';
import type { PackageMeasurementsResponse } from '#shared/comparison.defs';
import { PackageNameSchema } from '#shared/package.defs';
import type {
  PackageEvidenceBodyReader,
  PackageEvidenceNamespace,
  PackageEvidenceResponse,
  PackageEvidenceResponseBody,
} from '#shared/packageEvidence.defs';

const VERSION_MAX_LENGTH = 256;
const VersionSchema = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(VERSION_MAX_LENGTH));
const EvidenceRequestSchema = Schema.Struct({
  packageName: PackageNameSchema,
  from: VersionSchema,
  to: VersionSchema,
});

export type PackageEvidenceRequest = typeof EvidenceRequestSchema.Type;
export type PackageEvidencePath = 'measurements' | 'briefing-evidence';

/** Errors from the private evidence binding are intentionally opaque to public callers. */
export class PackageEvidenceClientError extends Error {
  readonly code = 'PACKAGE_EVIDENCE_UNAVAILABLE';

  constructor() {
    super('Package evidence service unavailable');
    this.name = 'PackageEvidenceClientError';
  }
}

export const decodePackageEvidenceRequest = (value: unknown): PackageEvidenceRequest => {
  try {
    return Schema.decodeUnknownSync(EvidenceRequestSchema)(value, { errors: 'all' });
  } catch {
    throw new PackageEvidenceClientError();
  }
};

export const decodeBriefingEvidence = (value: unknown): BriefingEvidence => {
  try {
    return Schema.decodeUnknownSync(BriefingEvidenceSchema)(value, { errors: 'all' });
  } catch {
    throw new PackageEvidenceClientError();
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isCompactTarball = (value: unknown): value is Record<string, unknown> =>
  isRecord(value) && !Object.hasOwn(value, 'files') && !Object.hasOwn(value, 'changelogs');

const isCompactMeasuredVersion = (value: unknown, requested: string): boolean => {
  if (!isRecord(value) || typeof value.version !== 'string') return false;
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
  return isCompactMeasuredVersion(value.from, request.from) && isCompactMeasuredVersion(value.to, request.to);
};

const cancelBody = async (response: PackageEvidenceResponse): Promise<void> => {
  try {
    await response.body?.cancel();
  } catch {
    // The original unavailable status is more useful than a cancellation failure.
  }
};

const readUnboundedJson = async (response: PackageEvidenceResponse): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    throw new PackageEvidenceClientError();
  }
};

const hasAcceptableContentLength = (response: PackageEvidenceResponse, maxBytes: number): boolean => {
  const declaredLength = response.headers.get('content-length');
  if (declaredLength === null) return true;
  const length = Number(declaredLength);
  return Number.isFinite(length) && length >= 0 && length <= maxBytes;
};

const readBodyChunk = async (reader: PackageEvidenceBodyReader): Promise<Uint8Array | undefined> => {
  const { done, value } = await reader.read();
  if (done) return undefined;
  if (!(value instanceof Uint8Array)) throw new Error('Evidence response did not contain a byte chunk');
  return value;
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

const readBoundedBody = async (body: PackageEvidenceResponseBody, maxBytes: number): Promise<Uint8Array> => {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const chunk = await readBodyChunk(reader);
      if (chunk === undefined) break;
      total += chunk.byteLength;
      if (total > maxBytes) throw new Error('Evidence response exceeds its bound');
      chunks.push(chunk);
    }
    return joinChunks(chunks, total);
  } catch {
    await cancelReader(reader);
    throw new PackageEvidenceClientError();
  } finally {
    reader.releaseLock();
  }
};

const parseJson = (bytes: Uint8Array): unknown => {
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return value;
  } catch {
    throw new PackageEvidenceClientError();
  }
};

const readBoundedJson = async (response: PackageEvidenceResponse, maxBytes: number): Promise<unknown> => {
  if (!hasAcceptableContentLength(response, maxBytes)) {
    await cancelBody(response);
    throw new PackageEvidenceClientError();
  }
  const body = response.body;
  if (body === null) throw new PackageEvidenceClientError();
  return parseJson(await readBoundedBody(body, maxBytes));
};

const readJson = async (response: PackageEvidenceResponse, maxBytes?: number): Promise<unknown> => {
  if (maxBytes === undefined) return readUnboundedJson(response);
  return readBoundedJson(response, maxBytes);
};

const requestEvidence = async (
  namespace: PackageEvidenceNamespace | undefined,
  path: PackageEvidencePath,
  rawRequest: unknown,
): Promise<{ readonly request: PackageEvidenceRequest; readonly value: unknown }> => {
  const request = decodePackageEvidenceRequest(rawRequest);
  if (namespace === undefined) throw new PackageEvidenceClientError();

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
      throw new PackageEvidenceClientError();
    }
    const maxBytes = path === 'briefing-evidence' ? BRIEFING_EVIDENCE_MAX_BYTES : undefined;
    return { request, value: await readJson(response, maxBytes) };
  } catch (error) {
    if (error instanceof PackageEvidenceClientError) throw error;
    throw new PackageEvidenceClientError();
  }
};

export async function getPackageMeasurements(
  namespace: PackageEvidenceNamespace | undefined,
  request: PackageEvidenceRequest,
): Promise<PackageMeasurementsResponse> {
  const result = await requestEvidence(namespace, 'measurements', request);
  if (!isCompactMeasurementsResponse(result.value, result.request)) throw new PackageEvidenceClientError();
  return result.value;
}

export async function getBriefingEvidence(
  namespace: PackageEvidenceNamespace | undefined,
  request: PackageEvidenceRequest,
): Promise<BriefingEvidence> {
  const result = await requestEvidence(namespace, 'briefing-evidence', request);
  const evidence = decodeBriefingEvidence(result.value);
  if (evidence.packageName !== request.packageName) throw new PackageEvidenceClientError();
  if (isExactSemver(request.from) && evidence.from !== request.from) throw new PackageEvidenceClientError();
  if (isExactSemver(request.to) && evidence.to !== request.to) throw new PackageEvidenceClientError();
  return evidence;
}
