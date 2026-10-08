import { Schema } from 'effect';
import { describe, expect, it, vi } from 'vitest';

import type { BriefingEvidence } from '../../shared/briefing.defs';
import { ensureGenerationTraceContext } from './jobTrace';

const TraceContextSchema = Schema.Struct({ traceId: Schema.String, spanId: Schema.String });
const LegacyRecordSchema = Schema.Struct({
  state: Schema.Literal('queued'),
  generationId: Schema.Number,
  revision: Schema.Number,
  traceContext: Schema.optionalKey(TraceContextSchema),
});
const ConsoleLogSchema = Schema.Struct({
  message: Schema.optionalKey(Schema.String),
  annotations: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
});
const decodeLegacyRecord = Schema.decodeUnknownSync(LegacyRecordSchema, { onExcessProperty: 'ignore' });
const decodeConsoleLog = Schema.decodeUnknownSync(ConsoleLogSchema, { onExcessProperty: 'ignore' });

type LegacyRecord = typeof LegacyRecordSchema.Type;

const legacy: LegacyRecord = { state: 'queued', generationId: 7, revision: 9 };
const packet: BriefingEvidence = {
  packageName: 'minimist',
  from: '1.0.0',
  to: '2.0.0',
  sources: [],
  gaps: [],
};

const parseConsoleLog = (line: unknown): typeof ConsoleLogSchema.Type | undefined => {
  if (typeof line !== 'string') return undefined;
  try {
    const value: unknown = JSON.parse(line);
    return decodeConsoleLog(value);
  } catch {
    return undefined;
  }
};

describe('generation trace persistence', () => {
  it('persists a successful acceptance root before logging its matching trace context', async () => {
    let persisted: LegacyRecord | undefined;
    const storage = {
      put: async (_key: string, value: unknown) => {
        persisted = decodeLegacyRecord(value);
      },
    };
    const consoleLog = vi.spyOn(console, 'info').mockImplementation(() => {});

    try {
      const result = await ensureGenerationTraceContext(
        storage,
        'job',
        { ...legacy, packet },
        'briefing.generation.accepted',
      );
      const context = result.generationContext;
      if (context === undefined) throw new Error('Expected an acceptance trace context');
      expect(persisted?.traceContext).toEqual(context);
      expect(result.record.traceContext).toEqual(context);

      const acceptanceLog = consoleLog.mock.calls
        .map(([line]) => parseConsoleLog(line))
        .find((line) => line?.message === 'briefing.generation.accepted');
      expect(acceptanceLog?.annotations).toMatchObject({
        ...context,
        'comparison.package.name': packet.packageName,
        'comparison.version.from': packet.from,
        'comparison.version.to': packet.to,
      });
    } finally {
      consoleLog.mockRestore();
    }
  });

  it('attaches packet identity when a restarted legacy job receives its trace context', async () => {
    const storage = { put: async () => undefined };
    const consoleLog = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      await ensureGenerationTraceContext(
        storage,
        'job',
        { ...legacy, packet },
        'briefing.generation.trace_context.attached',
      );

      const attachmentLog = consoleLog.mock.calls
        .map(([line]) => parseConsoleLog(line))
        .find((line) => line?.message === 'briefing.generation.trace_context.attached');
      expect(attachmentLog?.annotations).toMatchObject({
        'comparison.package.name': packet.packageName,
        'comparison.version.from': packet.from,
        'comparison.version.to': packet.to,
      });
    } finally {
      consoleLog.mockRestore();
    }
  });

  it('keeps a legacy pending job joinable when diagnostic writes fail', async () => {
    const storage = {
      put: async () => {
        throw new Error('storage writes unavailable');
      },
    };
    await expect(
      ensureGenerationTraceContext(storage, 'job', legacy, 'briefing.generation.trace_context.attached'),
    ).resolves.toEqual({ record: legacy });
  });

  it('does not hide a failed mandatory new-job write', async () => {
    const storage = {
      put: async () => {
        throw new Error('storage writes unavailable');
      },
    };
    await expect(ensureGenerationTraceContext(storage, 'job', legacy, 'briefing.generation.accepted')).rejects.toThrow(
      'storage writes unavailable',
    );
  });
});
