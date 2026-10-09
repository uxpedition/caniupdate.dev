import { sanitizedErrorAttributes } from '#shared/telemetryError';

export type TelemetryErrorBody = 'runtime.error' | 'runtime.warning';
export type TelemetryErrorAttributes = Record<string, string>;
export type TelemetryErrorReporter = (
  body: TelemetryErrorBody,
  attributes: TelemetryErrorAttributes,
  source: 'vue' | 'app' | 'chunk',
  error: Error | undefined,
) => void;

export type TelemetryErrorHookHandlers = {
  'vue:error': (error: unknown) => void;
  'app:error': (error: unknown) => void;
  'app:chunkError': (options: { error: unknown }) => void;
};

export const createTelemetryErrorHooks = (report: TelemetryErrorReporter): TelemetryErrorHookHandlers => {
  const capture = (body: TelemetryErrorBody, source: 'vue' | 'app' | 'chunk', thrown: unknown): void => {
    try {
      const error = thrown instanceof Error ? thrown : undefined;
      report(body, sanitizedErrorAttributes(source, error) ?? {}, source, error);
    } catch {
      // Error telemetry must not alter Vue or Nuxt error handling.
    }
  };

  return {
    'vue:error': (error) => capture('runtime.error', 'vue', error),
    'app:error': (error) => capture('runtime.error', 'app', error),
    'app:chunkError': (options) => {
      let error: unknown;
      try {
        error = options.error;
      } catch {
        return;
      }
      if (error instanceof Error) capture('runtime.warning', 'chunk', error);
    },
  };
};
