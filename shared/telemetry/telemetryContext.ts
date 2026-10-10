import { Schema } from 'effect';

type TelemetryWaitUntil = (promise: Promise<unknown>) => void;

/** The wrapper callable scope the runtimes hand to lifecycle hooks; waitUntil stays opaque until its callable check. */
type WaitUntilScope = { readonly waitUntil?: unknown };

type RuntimeScopeContainer = { readonly cloudflare?: { readonly context?: unknown } };

/** Any non-null, non-function container object: the gate before probing runtime scope wrappers. */
const isScopeObject = Schema.is(Schema.Struct({}));

const waitUntilFromScope = (scope: WaitUntilScope): TelemetryWaitUntil | undefined => {
  const waitUntil = scope.waitUntil;

  // oxlint-disable-next-line rules/no-runtime-typeof -- Platform-owned lifecycle hook: no schema can assert callability, only whichever container provides it.
  if (typeof waitUntil !== 'function') return undefined;

  return (promise) => {
    Reflect.apply(waitUntil, scope, [promise]);
  };
};

const cloudflareLifetimeScope = (context: RuntimeScopeContainer): WaitUntilScope | undefined => {
  const cloudflare = context.cloudflare;

  if (cloudflare === undefined) return undefined;

  const scope = cloudflare.context;

  if (scope === undefined || !isScopeObject(scope)) return undefined;

  return scope;
};

/** Resolve the Nitro/Cloudflare lifecycle hook without assuming H3 v2 event methods. */
// oxlint-disable-next-line rules/no-unknown-parameters -- Exported runtime-context boundary; the context is platform-owned until the container gate above.
export const telemetryWaitUntil = (context: unknown): TelemetryWaitUntil | undefined => {
  if (!isScopeObject(context)) return undefined;
  const direct = waitUntilFromScope(context);

  if (direct !== undefined) return direct;
  const cloudflareScope = cloudflareLifetimeScope(context);

  return cloudflareScope === undefined ? undefined : waitUntilFromScope(cloudflareScope);
};
