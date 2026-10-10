import { Schema } from 'effect';

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

// oxlint-disable-next-line rules/no-unknown-parameters -- Exported worker/config header decode boundary; the input is environment-owned until parsed above.
export const decodeTelemetryHeaders = (input: unknown): Record<string, string> => {
  const candidate = isScalarString(input) ? parseHeaderRecord(input) : input;

  let record: HeaderRecord | undefined;

  try {
    record = decodeHeaderRecord(candidate);
  } catch {
    record = undefined;
  }

  return record === undefined
    ? {}
    : Object.fromEntries(Object.entries(record).filter((entry): entry is [string, string] => isScalarString(entry[1])));
};
