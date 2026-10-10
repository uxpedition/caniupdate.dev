import { Effect } from 'effect';

import type { NuxtApp } from '#app';
import { defineNuxtPlugin } from '#imports';
import { createTelemetryRuntime } from '#shared/telemetry/telemetry';
import type { TelemetryRuntime } from '#shared/telemetry/telemetry';
import { decodeTelemetryRuntimeConfig } from '#shared/telemetry/telemetryConfig.defs';

import { initializeFaroErrors } from '../utils/faroErrors';
import type { FaroErrorsAdapter } from '../utils/faroErrors';
import { createTelemetryErrorHooks } from '../utils/telemetryErrorHooks';

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

type TelemetryPluginState = {
  telemetry: TelemetryRuntime | undefined;
  initialization: Promise<TelemetryRuntime> | undefined;
  errorCapture: FaroErrorsAdapter | undefined;
  unregisterHooks: (() => void) | undefined;
  appTeardownRegistered: boolean;
  teardown: (() => void) | undefined;
  generation: number;
  disposed: boolean;
};

type TelemetryHotData = Record<string, unknown> & { telemetryClientApps?: Map<NuxtApp, TelemetryPluginState> };

type TelemetryHotModule = {
  readonly data: TelemetryHotData;
  dispose(callback: (data: TelemetryHotData) => void): void;
};

const hot: TelemetryHotModule | undefined = import.meta.hot;

const telemetryClientApps = hot?.data.telemetryClientApps ?? new Map<NuxtApp, TelemetryPluginState>();

if (hot !== undefined) hot.data.telemetryClientApps = telemetryClientApps;

hot?.dispose(() => {
  for (const state of telemetryClientApps.values()) {
    state.generation += 1;
    state.unregisterHooks?.();
    state.unregisterHooks = undefined;
  }
});

const initializeTelemetry = async (): Promise<TelemetryRuntime> => {
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

  return telemetry;
};

const ensureTelemetry = async (state: TelemetryPluginState): Promise<TelemetryRuntime> => {
  if (state.telemetry !== undefined) return state.telemetry;
  const initialization = (state.initialization ??= initializeTelemetry());

  try {
    const telemetry = await initialization;

    if (!state.disposed) {
      state.telemetry = telemetry;
      state.initialization = undefined;
    }

    return telemetry;
  } catch {
    if (state.initialization === initialization) state.initialization = undefined;
    throw new Error('Telemetry runtime initialization failed');
  }
};

const logSafeConsoleFallback = (
  body: 'runtime.error' | 'runtime.warning',
  attributes: Record<string, string>,
): void => {
  try {
    if (body === 'runtime.error') console.error(body, attributes);
    else console.warn(body, attributes);
  } catch {
    // Console diagnostics must not alter application error handling.
  }
};

const reportTelemetryError = (
  state: TelemetryPluginState,
  body: 'runtime.error' | 'runtime.warning',
  attributes: Record<string, string>,
  source: 'vue' | 'app' | 'chunk',
  error: Error | undefined,
): void => {
  if (error !== undefined && source !== 'chunk') {
    try {
      if (state.errorCapture?.captureError(error, { source }) === true) return;
    } catch {
      // Fall through to the sanitized Effect log if Faro cannot accept this Error.
    }
  }

  const telemetry = state.telemetry;

  if (telemetry === undefined) {
    logSafeConsoleFallback(body, attributes);

    return;
  }

  const program = body === 'runtime.error' ? Effect.logError(body) : Effect.logWarning(body);

  try {
    void telemetry.runPromise(program.pipe(Effect.annotateLogs(attributes))).catch(() => {
      logSafeConsoleFallback(body, attributes);
    });
  } catch {
    logSafeConsoleFallback(body, attributes);
  }
};

const cleanupTelemetry = (nuxtApp: NuxtApp, state: TelemetryPluginState): void => {
  if (state.disposed) return;
  state.disposed = true;
  state.generation += 1;
  state.unregisterHooks?.();
  state.unregisterHooks = undefined;

  try {
    state.errorCapture?.stop();
  } catch {
    // Diagnostic shutdown must not interfere with app teardown.
  }

  state.errorCapture = undefined;

  const telemetry = state.telemetry;
  const initialization = state.initialization;
  state.telemetry = undefined;
  state.initialization = undefined;
  telemetryClientApps.delete(nuxtApp);

  if (telemetry !== undefined) void telemetry.dispose().catch(() => undefined);
  else if (initialization !== undefined)
    void initialization.then((runtime) => runtime.dispose()).catch(() => undefined);
};

const createPluginState = (nuxtApp: NuxtApp): TelemetryPluginState => {
  const existing = telemetryClientApps.get(nuxtApp);

  if (existing !== undefined) return existing;

  const state: TelemetryPluginState = {
    telemetry: undefined,
    initialization: undefined,
    errorCapture: undefined,
    unregisterHooks: undefined,
    appTeardownRegistered: false,
    teardown: undefined,
    generation: 0,
    disposed: false,
  };

  telemetryClientApps.set(nuxtApp, state);

  return state;
};

const registerErrorHooks = (nuxtApp: NuxtApp, state: TelemetryPluginState): void => {
  state.unregisterHooks?.();

  const hooks = createTelemetryErrorHooks((body, attributes, source, error) =>
    reportTelemetryError(state, body, attributes, source, error),
  );

  const unregister = [
    nuxtApp.hook('vue:error', hooks['vue:error']),
    nuxtApp.hook('app:error', hooks['app:error']),
    nuxtApp.hook('app:chunkError', hooks['app:chunkError']),
  ];

  state.unregisterHooks = () => {
    for (const unhook of unregister) {
      try {
        unhook();
      } catch {
        // A stale hook must not interfere with app or HMR teardown.
      }
    }
  };
};

const ensureErrorCapture = (state: TelemetryPluginState): void => {
  if (state.errorCapture !== undefined) return;

  try {
    state.errorCapture = initializeFaroErrors();
  } catch {
    logSafeConsoleFallback('runtime.warning', { 'error.source': 'browser' });
  }
};

const wireAppTeardown = (nuxtApp: NuxtApp, state: TelemetryPluginState): void => {
  if (!state.appTeardownRegistered) {
    state.appTeardownRegistered = true;
    nuxtApp.vueApp.onUnmount(() => state.teardown?.());
  }

  state.teardown = () => cleanupTelemetry(nuxtApp, state);
};

const setupTelemetry = async (nuxtApp: NuxtApp): Promise<{ provide: { telemetry: TelemetryRuntime } }> => {
  const state = createPluginState(nuxtApp);
  state.generation += 1;
  const generation = state.generation;
  registerErrorHooks(nuxtApp, state);
  ensureErrorCapture(state);
  wireAppTeardown(nuxtApp, state);

  const telemetry = await ensureTelemetry(state);

  if (state.generation !== generation || state.disposed) return { provide: { telemetry } };

  try {
    state.errorCapture?.attachRuntime(telemetry);
  } catch {
    logSafeConsoleFallback('runtime.warning', { 'error.source': 'browser' });
  }

  return { provide: { telemetry } };
};

export default defineNuxtPlugin({
  enforce: 'pre',
  env: { islands: false },
  setup: setupTelemetry,
});
