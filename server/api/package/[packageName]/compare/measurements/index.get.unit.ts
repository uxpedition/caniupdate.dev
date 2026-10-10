import { mockEvent } from 'h3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MeasuredPackageVersion, PackageMeasurementsResponse } from '#shared/comparison/comparison.defs';
import type {
  PackageEvidenceNamespace,
  PackageEvidenceObject,
  PackageEvidenceObjectId,
} from '#shared/comparison/evidence/packageEvidence.defs';

import handler from './index.get';

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

/** The mock id fabricates the opaque identity the namespace hands back; structurally it carries only a string. */
const mockObjectId = (name: string): PackageEvidenceObjectId => ({ toString: () => name });

const idFromName = vi.fn(mockObjectId);

const objectFetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

const getObject = vi.fn<(id: PackageEvidenceObjectId) => PackageEvidenceObject>(() => ({ fetch: objectFetch }));

const namespace: PackageEvidenceNamespace = { idFromName, get: getObject };

const measuredVersion = (version: string): MeasuredPackageVersion => ({
  name: 'minimist',
  version,
  dist: { tarball: `https://registry.npmjs.org/minimist/-/${version}.tgz` },
  licenses: [],
  deprecated: false,
  engines: {},
  dependencies: {},
  peerDependencies: {},
  optionalDependencies: {},
  optionalPeers: [],
  installScripts: [],
  installScriptCommands: {},
  moduleFormat: {},
  vulnerabilities: { status: 'unavailable', count: null, advisories: [] },
  bundleSize: {
    provider: 'bundlephobia',
    url: `https://bundlephobia.com/package/minimist@${version}`,
    status: 'unavailable',
    size: null,
    gzip: null,
  },
  tarball: {
    status: 'available',
    reasons: [],
    url: `https://registry.npmjs.org/minimist/-/${version}.tgz`,
    fileCount: 1,
    changelogCount: 0,
  },
});

const measurementResponse = (): PackageMeasurementsResponse => ({
  packageName: 'minimist',
  from: measuredVersion('1.0.0'),
  to: measuredVersion('2.0.0'),
  comparison: {
    sizes: {
      unpacked: {
        status: 'unavailable',
        from: null,
        to: null,
        delta: null,
        percent: null,
        reasons: [],
        sources: { from: null, to: null },
      },
      bundle: {
        provider: 'bundlephobia',
        methodology: 'provider-estimate',
        minified: { status: 'unavailable', from: null, to: null, delta: null, percent: null, reasons: [] },
        gzip: { status: 'unavailable', from: null, to: null, delta: null, percent: null, reasons: [] },
      },
    },
    advisories: {
      status: 'unavailable',
      coverage: { from: 'unavailable', to: 'unavailable' },
      reasons: [],
      fromOnly: [],
      both: [],
      toOnly: [],
      uncertain: [],
    },
  },
});

function eventFor(
  from = '1.0.0',
  to = '2.0.0',
  packageName = 'minimist',
  binding: PackageEvidenceNamespace | undefined = namespace,
) {
  const event = mockEvent(
    `http://localhost/api/package/${encodeURIComponent(packageName)}/compare/measurements?${new URLSearchParams({ from, to })}`,
  );

  event.context.params = { packageName: encodeURIComponent(packageName) };
  event.context.cloudflare = { env: { PACKAGE_EVIDENCE: binding } };

  return event;
}

beforeEach(() => {
  idFromName.mockClear();
  getObject.mockClear();
  objectFetch.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('measurement evidence boundary', () => {
  it('selects the package object and forwards the compact request', async () => {
    objectFetch.mockResolvedValue(Response.json(measurementResponse()));

    const result = await handler(eventFor());

    expect(result).toEqual(measurementResponse());
    expect(idFromName).toHaveBeenCalledWith('minimist');
    expect(getObject).toHaveBeenCalledTimes(1);
    const call = objectFetch.mock.calls[0];

    if (call === undefined) throw new Error('Expected a Durable Object request');
    const request = new Request(call[0], call[1]);
    expect(request.url).toBe('https://package-evidence/measurements');
    expect(request.method).toBe('POST');
    expect(request.headers.get('content-type')).toBe('application/json');
    await expect(request.json()).resolves.toEqual({ packageName: 'minimist', from: '1.0.0', to: '2.0.0' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized unavailable status when the binding is missing', async () => {
    await expect(handler(eventFor('1.0.0', '2.0.0', 'minimist', undefined))).rejects.toMatchObject({
      statusCode: 503,
      statusMessage: 'Evidence service unavailable',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized unavailable status for backend failures without a local fallback', async () => {
    objectFetch.mockResolvedValue(new Response('backend internals', { status: 429 }));

    await expect(handler(eventFor())).rejects.toMatchObject({
      statusCode: 503,
      statusMessage: 'Evidence service unavailable',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects malformed route input before selecting an object', async () => {
    await expect(handler(eventFor('', '2.0.0'))).rejects.toMatchObject({ statusCode: 400 });
    expect(idFromName).not.toHaveBeenCalled();
    expect(objectFetch).not.toHaveBeenCalled();
  });

  it('rejects a stale exact-version response from the object', async () => {
    objectFetch.mockResolvedValue(Response.json(measurementResponse()));

    await expect(handler(eventFor('1.1.0', '2.0.0'))).rejects.toMatchObject({ statusCode: 503 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an inventory-shaped response instead of forwarding full archive evidence', async () => {
    const response = measurementResponse();

    const invalid: unknown = {
      ...response,
      from: {
        ...response.from,
        tarball: {
          ...response.from.tarball,
          files: [{ path: 'package/index.js', type: 'file', size: 1, sha256: null }],
        },
      },
    };

    objectFetch.mockResolvedValue(Response.json(invalid));

    await expect(handler(eventFor())).rejects.toMatchObject({ statusCode: 503 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
