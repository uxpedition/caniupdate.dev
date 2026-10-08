import { describe, expect, it } from 'vitest';

import { decodeTelemetryPayload } from './telemetry.defs';

const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';
const SPAN_ID = '00f067aa0ba902b7';
const PARENT_SPAN_ID = 'b7ad6b7169203331';

const first = <Value>(values: ReadonlyArray<Value>): Value => {
  const value = values[0];
  if (value === undefined) throw new Error('Telemetry fixture is missing a required record');
  return value;
};

const logPayload = () => ({
  resourceLogs: [
    {
      resource: {
        attributes: [
          { key: 'service.name', value: { stringValue: 'can-i-update-browser' } },
          { key: 'service.version', value: { stringValue: '1.2.3' } },
          { key: 'api.key', value: { stringValue: 'collector-secret' } },
        ],
        droppedAttributesCount: 0,
        url: 'https://private.example/path?token=collector-secret',
      },
      scopeLogs: [
        {
          scope: { name: 'can-i-update-browser', version: 'private-version', attributes: [{ key: 'token' }] },
          logRecords: [
            {
              timeUnixNano: '1700000000000000000',
              observedTimeUnixNano: '1700000000000000001',
              severityNumber: 9,
              severityText: 'Info',
              body: { stringValue: 'briefing.submission.accepted' },
              attributes: [
                { key: 'traceId', value: { stringValue: TRACE_ID } },
                { key: 'spanId', value: { stringValue: SPAN_ID } },
                { key: 'parentSpanId', value: { stringValue: PARENT_SPAN_ID } },
                {
                  key: 'linkedGeneration',
                  value: { stringValue: JSON.stringify({ traceId: TRACE_ID, spanId: PARENT_SPAN_ID }) },
                },
                { key: 'reason', value: { stringValue: 'provider-error' } },
                { key: 'log.error', value: { stringValue: 'collector-secret' } },
                { key: 'prompt', value: { stringValue: 'private release evidence' } },
              ],
              traceId: TRACE_ID,
              spanId: SPAN_ID,
              flags: 1,
            },
          ],
        },
      ],
    },
  ],
});

const tracePayload = () => ({
  resourceSpans: [
    {
      resource: {
        attributes: [{ key: 'service.name', value: { stringValue: 'can-i-update-nuxt' } }],
        droppedAttributesCount: 0,
      },
      scopeSpans: [
        {
          scope: { name: 'can-i-update-nuxt' },
          spans: [
            {
              traceId: TRACE_ID,
              spanId: SPAN_ID,
              parentSpanId: PARENT_SPAN_ID,
              name: 'briefing.submit',
              kind: 2,
              startTimeUnixNano: '1700000000000000000',
              endTimeUnixNano: '1700000000000000001',
              attributes: [{ key: 'authorization', value: { stringValue: 'collector-secret' } }],
              droppedAttributesCount: 0,
              events: [
                {
                  name: 'exception',
                  timeUnixNano: '1700000000000000001',
                  attributes: [
                    { key: 'exception.message', value: { stringValue: 'collector-secret' } },
                    { key: 'exception.stacktrace', value: { stringValue: 'collector-secret' } },
                  ],
                  droppedAttributesCount: 0,
                },
              ],
              droppedEventsCount: 0,
              status: { code: 2, message: 'collector-secret' },
              links: [
                {
                  traceId: TRACE_ID,
                  spanId: PARENT_SPAN_ID,
                  attributes: [{ key: 'relationship', value: { stringValue: 'shared-generation' } }],
                  droppedAttributesCount: 0,
                },
              ],
              droppedLinksCount: 0,
            },
          ],
        },
      ],
    },
  ],
});

describe('decodeTelemetryPayload', () => {
  it('retains approved log identities and linked context while stripping unknown fields and annotations', () => {
    const decoded = decodeTelemetryPayload('logs', logPayload());
    const serialized = JSON.stringify(decoded);

    expect(serialized).not.toContain('collector-secret');
    expect(serialized).not.toContain('private release evidence');
    expect(decoded).toMatchObject({
      resourceLogs: [
        {
          resource: {
            attributes: [
              { key: 'service.name', value: { stringValue: 'can-i-update-browser' } },
              { key: 'service.version', value: { stringValue: '1.2.3' } },
            ],
          },
          scopeLogs: [
            {
              scope: { name: 'can-i-update-browser' },
              logRecords: [
                {
                  traceId: TRACE_ID,
                  spanId: SPAN_ID,
                  body: { stringValue: 'briefing.submission.accepted' },
                  attributes: [
                    { key: 'traceId', value: { stringValue: TRACE_ID } },
                    { key: 'spanId', value: { stringValue: SPAN_ID } },
                    { key: 'parentSpanId', value: { stringValue: PARENT_SPAN_ID } },
                    { key: 'reason', value: { stringValue: 'provider-error' } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it('preserves hex IDs and span links while removing exception text and error descriptions', () => {
    const decoded = decodeTelemetryPayload('traces', tracePayload());
    const span = decoded.resourceSpans[0]?.scopeSpans[0]?.spans[0];

    expect(span).toMatchObject({
      traceId: TRACE_ID,
      spanId: SPAN_ID,
      parentSpanId: PARENT_SPAN_ID,
      status: { code: 2 },
      links: [
        {
          traceId: TRACE_ID,
          spanId: PARENT_SPAN_ID,
          attributes: [{ key: 'relationship', value: { stringValue: 'shared-generation' } }],
        },
      ],
    });
    expect(span?.status).not.toHaveProperty('message');
    expect(span?.events).toEqual([]);
    expect(JSON.stringify(decoded)).not.toContain('collector-secret');
    expect(decodeTelemetryPayload('traces', decoded)).toEqual(decoded);
  });

  it.each([
    ['name', 'PackageEvidenceClientError', true],
    ['name', 'BriefingServiceBindingUnavailable', true],
    ['reason', 'binding-unavailable', true],
    ['reason', 'transport', true],
    ['reason', 'upstream', true],
    ['reason', 'protocol', true],
    ['name', 'Provider credential rejected', false],
    ['reason', 'token=private-secret', false],
    ['comparison.package.name', '@scope/package', true],
    ['comparison.package.name', 'https://secret.example/token', false],
    ['comparison.package.name', 'x'.repeat(215), false],
    ['comparison.version.from', '1.2.3-beta.1+build.7', true],
    ['comparison.version.to', 'latest', false],
    ['comparison.requested.from', '>=1.0.0 <2.0.0', true],
    ['comparison.requested.to', 'latest', true],
    ['comparison.requested.to', 'file:/private/token', false],
    ['comparison.requested.to', 'latest\nprivate-message', false],
    ['comparison.requested.to', 'x'.repeat(257), false],
  ])('retains only validated comparison attribute %s=%s', (key, value, retained) => {
    const payload = logPayload();
    const record = first(first(first(payload.resourceLogs).scopeLogs).logRecords);
    record.attributes = [{ key, value: { stringValue: value } }];
    const decoded = decodeTelemetryPayload('logs', payload);
    const attributes = first(first(first(decoded.resourceLogs).scopeLogs).logRecords).attributes;
    expect(attributes).toEqual(retained ? [{ key, value: { stringValue: value } }] : []);
  });

  it('rejects unknown instrumentation, malformed hexadecimal IDs, and over-budget record counts', () => {
    const unknownInstrumentation = logPayload();
    first(first(unknownInstrumentation.resourceLogs).scopeLogs).scope.name = 'unreviewed.operation';
    expect(() => decodeTelemetryPayload('logs', unknownInstrumentation)).toThrow();

    const malformedId = tracePayload();
    first(first(first(malformedId.resourceSpans).scopeSpans).spans).traceId = '4bf92f3577b34da6a3ce929d0e0e473g';
    expect(() => decodeTelemetryPayload('traces', malformedId)).toThrow();

    const overBudget = logPayload();
    const scopeLogs = first(first(overBudget.resourceLogs).scopeLogs);
    const logRecords = scopeLogs.logRecords.slice(0, 0);
    const record = first(first(first(logPayload().resourceLogs).scopeLogs).logRecords);
    for (let index = 0; index < 65; index++) logRecords.push({ ...record });
    scopeLogs.logRecords = logRecords;
    expect(() => decodeTelemetryPayload('logs', overBudget)).toThrow();
  });
});
