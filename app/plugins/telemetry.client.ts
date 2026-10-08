import { defineNuxtPlugin } from '#imports';
import { createTelemetryRuntime } from '#shared/telemetry';
import { decodeTelemetryRuntimeConfig } from '#shared/telemetryConfig.defs';

const TELEMETRY_CONFIG_TIMEOUT_MS = 1_000;

const readTelemetryEnabled = async (): Promise<boolean> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TELEMETRY_CONFIG_TIMEOUT_MS);
  try {
    const response = await fetch(new URL('/api/telemetry/config', window.location.origin), {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
      redirect: 'error',
      signal: controller.signal,
    });
    if (!response.ok) return false;
    return decodeTelemetryRuntimeConfig(await response.json()).enabled;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
};

export default defineNuxtPlugin(async () => {
  const endpoint = (await readTelemetryEnabled())
    ? new URL('/api/telemetry', window.location.origin).toString().replace(/\/$/, '')
    : undefined;
  const runtimeOptions = {
    ...(endpoint === undefined ? {} : { endpoint }),
    serviceName: 'can-i-update-browser',
  };
  let telemetry = createTelemetryRuntime(runtimeOptions);
  try {
    await telemetry.context();
  } catch {
    void telemetry.dispose().catch(() => undefined);
    telemetry = createTelemetryRuntime({ serviceName: 'can-i-update-browser' });
    await telemetry.context().catch(() => undefined);
  }
  return { provide: { telemetry } };
});
