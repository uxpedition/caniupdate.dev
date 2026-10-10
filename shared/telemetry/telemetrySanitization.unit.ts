import type { OtlpTracer } from 'effect/observability';
import { describe, expect, it } from 'vitest';

import { decodeTelemetryPayload } from './telemetry.defs';
import { sanitizeTelemetryTraces } from './telemetrySanitization';

const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';

const ROOT_SPAN_ID = '00f067aa0ba902b7';

const HTTP_SPAN_ID = '00f067aa0ba902b8';

const CHILD_SPAN_ID = '00f067aa0ba902b9';

const TIME = '1700000000000000000';

const responseHeaders = Array.from({ length: 33 }, (_, index) => ({
  key: `http.response.header.x-${index}`,
  value: { stringValue: `provider-header-${index}` },
}));

const span = (
  spanId: string,
  name: string,
  options: {
    readonly parentSpanId?: string;
    readonly attributes?: OtlpTracer.TraceData['resourceSpans'][number]['scopeSpans'][number]['spans'][number]['attributes'];
    readonly events?: OtlpTracer.TraceData['resourceSpans'][number]['scopeSpans'][number]['spans'][number]['events'];
    readonly status?: OtlpTracer.TraceData['resourceSpans'][number]['scopeSpans'][number]['spans'][number]['status'];
    readonly links?: OtlpTracer.TraceData['resourceSpans'][number]['scopeSpans'][number]['spans'][number]['links'];
  } = {},
): OtlpTracer.TraceData['resourceSpans'][number]['scopeSpans'][number]['spans'][number] => ({
  traceId: TRACE_ID,
  spanId,
  parentSpanId: options.parentSpanId,
  name,
  kind: 1,
  startTimeUnixNano: TIME,
  endTimeUnixNano: TIME,
  attributes: options.attributes ?? [],
  droppedAttributesCount: 0,
  events: options.events ?? [],
  droppedEventsCount: 0,
  status: options.status ?? { code: 0 as const },
  links: options.links ?? [],
  droppedLinksCount: 0,
});

describe('telemetry sanitization', () => {
  it('removes unreviewed oversized spans and private fields before strict bounds while retaining trace links', () => {
    const privateText = `provider-response-secret-${'x'.repeat(262_145)}`;

    const nativeBatch = {
      resourceSpans: [
        {
          resource: {
            attributes: [
              { key: 'service.name', value: { stringValue: 'can-i-update-briefing' } },
              { key: '__proto__', value: { stringValue: privateText } },
              { key: 'constructor', value: { stringValue: privateText } },
            ],
            droppedAttributesCount: 0,
          },
          scopeSpans: [
            {
              scope: { name: 'can-i-update-briefing' },
              spans: [
                span(ROOT_SPAN_ID, 'briefing.generation', {
                  attributes: [
                    { key: '__proto__', value: { stringValue: privateText } },
                    { key: 'constructor', value: { stringValue: privateText } },
                  ],
                }),
                span(HTTP_SPAN_ID, 'http.client POST', {
                  parentSpanId: ROOT_SPAN_ID,
                  attributes: responseHeaders,
                  status: { code: 2, message: privateText },
                  events: [
                    {
                      name: privateText,
                      timeUnixNano: TIME,
                      attributes: [{ key: 'provider.response.payload', value: { stringValue: privateText } }],
                      droppedAttributesCount: 0,
                    },
                  ],
                }),
                span(CHILD_SPAN_ID, 'briefing.generation.accepted', {
                  parentSpanId: ROOT_SPAN_ID,
                  attributes: responseHeaders,
                  status: { code: 2, message: privateText },
                  events: [
                    {
                      name: privateText,
                      timeUnixNano: TIME,
                      attributes: [{ key: 'provider.response.payload', value: { stringValue: privateText } }],
                      droppedAttributesCount: 0,
                    },
                  ],
                  links: [
                    {
                      traceId: TRACE_ID,
                      spanId: ROOT_SPAN_ID,
                      attributes: [
                        { key: 'relationship', value: { stringValue: 'shared-generation' } },
                        { key: 'provider.payload', value: { stringValue: privateText } },
                      ],
                      droppedAttributesCount: 0,
                    },
                  ],
                }),
              ],
            },
          ],
        },
      ],
    } satisfies OtlpTracer.TraceData;

    const decoded = decodeTelemetryPayload('traces', sanitizeTelemetryTraces(nativeBatch));
    const spans = decoded.resourceSpans.flatMap((resource) => resource.scopeSpans.flatMap((scope) => scope.spans));
    const root = spans.find(({ name }) => name === 'briefing.generation');
    const child = spans.find(({ name }) => name === 'briefing.generation.accepted');

    expect(spans.map(({ name }) => name).sort()).toEqual(['briefing.generation', 'briefing.generation.accepted']);
    expect(root).toMatchObject({ traceId: TRACE_ID, spanId: ROOT_SPAN_ID });
    expect(child).toMatchObject({
      traceId: TRACE_ID,
      spanId: CHILD_SPAN_ID,
      parentSpanId: ROOT_SPAN_ID,
      attributes: [],
      status: { code: 2 },
      events: [],
      links: [
        {
          traceId: TRACE_ID,
          spanId: ROOT_SPAN_ID,
          attributes: [{ key: 'relationship', value: { stringValue: 'shared-generation' } }],
        },
      ],
    });
    expect(JSON.stringify(decoded)).not.toContain('provider-response-secret');
    expect(JSON.stringify(decoded)).not.toContain('provider-header-');
  });
});
