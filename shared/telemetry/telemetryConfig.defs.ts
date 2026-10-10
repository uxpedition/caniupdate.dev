import { Schema } from 'effect';

export const TelemetryRuntimeConfigSchema = Schema.Struct({ enabled: Schema.Boolean });

export type TelemetryRuntimeConfig = typeof TelemetryRuntimeConfigSchema.Type;

const decodeRuntimeConfig = Schema.decodeUnknownSync(TelemetryRuntimeConfigSchema, {
  errors: 'all',
  onExcessProperty: 'error',
});

export const decodeTelemetryRuntimeConfig = (value: unknown): TelemetryRuntimeConfig => decodeRuntimeConfig(value);

const decodeHeaderRecord = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown), { errors: 'all' });

const telemetryHeaderRecord = (input: unknown): Readonly<Record<string, unknown>> | undefined => {
  let value = input;

  if (typeof value === 'string') {
    if (value.trim() === '') return undefined;

    try {
      const parsed: unknown = JSON.parse(value);
      value = parsed;
    } catch {
      return undefined;
    }
  }

  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;

  try {
    return decodeHeaderRecord(value);
  } catch {
    return undefined;
  }
};

export const decodeTelemetryHeaders = (input: unknown): Record<string, string> => {
  const record = telemetryHeaderRecord(input);

  return record === undefined
    ? {}
    : Object.fromEntries(
        Object.entries(record).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
      );
};
