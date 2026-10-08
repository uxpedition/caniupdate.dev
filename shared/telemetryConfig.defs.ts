import { Schema } from 'effect';

export const TelemetryRuntimeConfigSchema = Schema.Struct({ enabled: Schema.Boolean });
export type TelemetryRuntimeConfig = typeof TelemetryRuntimeConfigSchema.Type;

const decodeRuntimeConfig = Schema.decodeUnknownSync(TelemetryRuntimeConfigSchema, {
  errors: 'all',
  onExcessProperty: 'error',
});

export const decodeTelemetryRuntimeConfig = (value: unknown): TelemetryRuntimeConfig => decodeRuntimeConfig(value);
