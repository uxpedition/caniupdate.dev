import { flow, Result, Schema } from 'effect';

export const TelemetryRuntimeConfigSchema = Schema.Struct({ enabled: Schema.Boolean });

export type TelemetryRuntimeConfig = typeof TelemetryRuntimeConfigSchema.Type;

export const decodeTelemetryRuntimeConfig = Schema.decodeUnknownSync(TelemetryRuntimeConfigSchema, {
  errors: 'all',
  onExcessProperty: 'error',
});

const HeaderRecordSchema = Schema.Record(Schema.String, Schema.Unknown);

type HeaderRecord = typeof HeaderRecordSchema.Type;

const decodeHeaderRecord = Schema.decodeUnknownSync(HeaderRecordSchema, { errors: 'all' });

const isScalarString = Schema.is(Schema.String);

/** Parse JSON text into a header record; empty or malformed text yields nothing. */
const parseHeaderRecord = (text: string): HeaderRecord | undefined => {
  if (text.trim() === '') return undefined;

  try {
    const parsed: unknown = JSON.parse(text);

    return decodeHeaderRecord(parsed);
  } catch {
    return undefined;
  }
};

/** Decode JSON text or a header record at ingress; malformed configuration contributes no headers. */
export const decodeTelemetryHeaders = flow(
  Schema.decodeUnknownResult(Schema.Union([Schema.String, HeaderRecordSchema]), { errors: 'all' }),
  (result): Record<string, string> => {
    const input = Result.getOrUndefined(result);
    const record = isScalarString(input) ? parseHeaderRecord(input) : input;

    return record === undefined
      ? {}
      : Object.fromEntries(
          Object.entries(record).filter((entry): entry is [string, string] => isScalarString(entry[1])),
        );
  },
);
