/** Standalone Vitest substitute for Nitro's virtual runtime-config import. */
export const useRuntimeConfig = (_event?: unknown) => ({
  otelEndpoint: '',
  otelHeaders: {},
  public: { telemetryEnabled: false },
});
