/** Standalone Vitest substitute for Nitro's virtual runtime-config import. */
export const useRuntimeConfig = () => ({
  otelEndpoint: '',
  otelHeaders: {},
  public: { telemetryEnabled: false },
});
