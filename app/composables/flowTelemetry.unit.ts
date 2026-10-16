import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTelemetryRuntime } from '#shared/telemetry/telemetry';
import { decodeTelemetryPayload } from '#shared/telemetry/telemetry.defs';

import { PACKAGE_REQUEST_SUCCESS_SAMPLE_RATE, PACKAGE_SEARCH_FLOW, reportPackageRequest } from './flowTelemetry';

const installCollector = () => {
  const requests: Array<{ url: string; body: string }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      requests.push({ url: request.url, body: await request.text() });

      return new Response(null, { status: 200 });
    }),
  );

  return {
    requests,
    telemetry: createTelemetryRuntime({ endpoint: 'http://collector.test:4318', serviceName: 'can-i-update-browser' }),
  };
};

/** The exported flow records, in emission order. An absent export reads as no records, never as a passing default. */
const exportedFlowRecords = (requests: readonly { url: string; body: string }[]) => {
  const request = requests.find(({ url }) => url.endsWith('/v1/logs'));

  if (request === undefined) return [];

  const logs = decodeTelemetryPayload('logs')(JSON.parse(request.body));

  return logs.resourceLogs
    .flatMap(({ scopeLogs }) => scopeLogs.flatMap(({ logRecords }) => logRecords))
    .filter(({ body }) => body.stringValue === PACKAGE_SEARCH_FLOW.event);
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('reportPackageRequest', () => {
  it('samples a success only when the random draw is strictly below the sample rate', async () => {
    const { requests, telemetry } = installCollector();
    await telemetry.context();
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(PACKAGE_REQUEST_SUCCESS_SAMPLE_RATE)
      .mockReturnValueOnce(PACKAGE_REQUEST_SUCCESS_SAMPLE_RATE - Number.EPSILON);

    try {
      await expect(
        reportPackageRequest(
          telemetry,
          PACKAGE_SEARCH_FLOW,
          new AbortController().signal,
          async () => ['a'],
          (value) => value.length,
        ),
      ).resolves.toEqual(['a']);
      await expect(
        reportPackageRequest(
          telemetry,
          PACKAGE_SEARCH_FLOW,
          new AbortController().signal,
          async () => ['a', 'b', 'c'],
          (value) => value.length,
        ),
      ).resolves.toEqual(['a', 'b', 'c']);
    } finally {
      await telemetry.dispose();
    }

    const records = exportedFlowRecords(requests);
    expect(records).toHaveLength(1);
    expect(records[0]?.attributes).toEqual(
      expect.arrayContaining([
        { key: 'outcome', value: { stringValue: 'success' } },
        { key: 'resultCount', value: { stringValue: '2-10' } },
      ]),
    );
  });

  it('never samples a failure, even when the draw would drop a success', async () => {
    const { requests, telemetry } = installCollector();
    await telemetry.context();
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const failure = Object.assign(new Error('PRIVATE_FAILURE_MARKER'), { status: 404 });

    try {
      await expect(
        reportPackageRequest(
          telemetry,
          PACKAGE_SEARCH_FLOW,
          new AbortController().signal,
          async () => ['a'],
          () => 1,
        ),
      ).resolves.toEqual(['a']);
      await expect(
        reportPackageRequest(
          telemetry,
          PACKAGE_SEARCH_FLOW,
          new AbortController().signal,
          () => Promise.reject(failure),
          () => 0,
        ),
      ).rejects.toBe(failure);
    } finally {
      await telemetry.dispose();
    }

    const records = exportedFlowRecords(requests);
    expect(records).toHaveLength(1);
    expect(records[0]?.attributes).toEqual(
      expect.arrayContaining([
        { key: 'outcome', value: { stringValue: 'failure' } },
        { key: 'reason', value: { stringValue: 'invalid-input' } },
        { key: 'statusClass', value: { stringValue: '4xx' } },
      ]),
    );
  });

  it('classifies a 5xx failure from its numeric status only, and never exports the error text', async () => {
    const { requests, telemetry } = installCollector();
    await telemetry.context();
    const failure = Object.assign(new Error('PRIVATE_FAILURE_MARKER'), { status: 502 });

    try {
      await expect(
        reportPackageRequest(
          telemetry,
          PACKAGE_SEARCH_FLOW,
          new AbortController().signal,
          () => Promise.reject(failure),
          () => 0,
        ),
      ).rejects.toBe(failure);
    } finally {
      await telemetry.dispose();
    }

    const records = exportedFlowRecords(requests);
    expect(records).toHaveLength(1);
    expect(records[0]?.attributes).toEqual(
      expect.arrayContaining([
        { key: 'reason', value: { stringValue: 'upstream' } },
        { key: 'statusClass', value: { stringValue: '5xx' } },
      ]),
    );
    expect(JSON.stringify(requests)).not.toContain('PRIVATE_FAILURE_MARKER');
  });

  it('stays silent for an aborted request while still rethrowing its original rejection', async () => {
    const { requests, telemetry } = installCollector();
    await telemetry.context();
    const controller = new AbortController();
    const aborted = new Error('PRIVATE_ABORT_MARKER');
    const control = Object.assign(new Error('control failure'), { status: 500 });

    try {
      await expect(
        reportPackageRequest(
          telemetry,
          PACKAGE_SEARCH_FLOW,
          controller.signal,
          () => {
            controller.abort();

            return Promise.reject(aborted);
          },
          () => 0,
        ),
      ).rejects.toBe(aborted);
      // A live failure after the silent one proves the export ran, so an empty record list is a real silence.
      await expect(
        reportPackageRequest(
          telemetry,
          PACKAGE_SEARCH_FLOW,
          new AbortController().signal,
          () => Promise.reject(control),
          () => 0,
        ),
      ).rejects.toBe(control);
    } finally {
      await telemetry.dispose();
    }

    const records = exportedFlowRecords(requests);
    expect(records).toHaveLength(1);
    expect(records[0]?.attributes).toEqual(
      expect.arrayContaining([{ key: 'reason', value: { stringValue: 'upstream' } }]),
    );
    expect(JSON.stringify(requests)).not.toContain('PRIVATE_ABORT_MARKER');
  });

  it('returns the original value when the result counter throws, and emits nothing for that success', async () => {
    const { requests, telemetry } = installCollector();
    await telemetry.context();
    vi.spyOn(Math, 'random').mockReturnValue(0);

    try {
      await expect(
        reportPackageRequest(
          telemetry,
          PACKAGE_SEARCH_FLOW,
          new AbortController().signal,
          async () => ['a'],
          () => {
            throw new Error('PRIVATE_COUNT_MARKER');
          },
        ),
      ).resolves.toEqual(['a']);
      // Control success with a working counter: the only exported record must be this one.
      await expect(
        reportPackageRequest(
          telemetry,
          PACKAGE_SEARCH_FLOW,
          new AbortController().signal,
          async () => ['a'],
          () => 1,
        ),
      ).resolves.toEqual(['a']);
    } finally {
      await telemetry.dispose();
    }

    const records = exportedFlowRecords(requests);
    expect(records).toHaveLength(1);
    expect(records[0]?.attributes).toEqual(
      expect.arrayContaining([{ key: 'resultCount', value: { stringValue: '1' } }]),
    );
    expect(JSON.stringify(requests)).not.toContain('PRIVATE_COUNT_MARKER');
  });

  it('returns the original value and keeps the failure rejection when the sampler throws', async () => {
    const { requests, telemetry } = installCollector();
    await telemetry.context();
    vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('PRIVATE_SAMPLER_MARKER');
    });
    const failure = Object.assign(new Error('failure'), { status: 503 });

    try {
      await expect(
        reportPackageRequest(
          telemetry,
          PACKAGE_SEARCH_FLOW,
          new AbortController().signal,
          async () => ['a'],
          () => 1,
        ),
      ).resolves.toEqual(['a']);
      await expect(
        reportPackageRequest(
          telemetry,
          PACKAGE_SEARCH_FLOW,
          new AbortController().signal,
          () => Promise.reject(failure),
          () => 0,
        ),
      ).rejects.toBe(failure);
    } finally {
      await telemetry.dispose();
    }

    const records = exportedFlowRecords(requests);
    expect(records).toHaveLength(1);
    expect(records[0]?.attributes).toEqual(
      expect.arrayContaining([{ key: 'outcome', value: { stringValue: 'failure' } }]),
    );
    expect(JSON.stringify(requests)).not.toContain('PRIVATE_SAMPLER_MARKER');
  });

  it('returns the original value and keeps the rejection when the telemetry runtime throws', async () => {
    const { telemetry } = installCollector();
    await telemetry.context();

    const report = vi.spyOn(telemetry, 'runSync').mockImplementation(() => {
      throw new Error('PRIVATE_RUNTIME_MARKER');
    });

    vi.spyOn(Math, 'random').mockReturnValue(0);

    const failure = Object.assign(new Error('failure'), { status: 404 });

    try {
      await expect(
        reportPackageRequest(
          telemetry,
          PACKAGE_SEARCH_FLOW,
          new AbortController().signal,
          async () => ['a'],
          () => 1,
        ),
      ).resolves.toEqual(['a']);
      await expect(
        reportPackageRequest(
          telemetry,
          PACKAGE_SEARCH_FLOW,
          new AbortController().signal,
          () => Promise.reject(failure),
          () => 0,
        ),
      ).rejects.toBe(failure);
      expect(report).toHaveBeenCalledTimes(2);
    } finally {
      await telemetry.dispose();
    }
  });
});
