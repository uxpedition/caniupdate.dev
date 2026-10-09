type TelemetryWaitUntil = (promise: Promise<unknown>) => void;

const waitUntilFromScope = (scope: object): TelemetryWaitUntil | undefined => {
  if (!('waitUntil' in scope)) return undefined;
  const waitUntil = scope.waitUntil;
  if (typeof waitUntil !== 'function') return undefined;
  return (promise) => {
    Reflect.apply(waitUntil, scope, [promise]);
  };
};

const cloudflareLifetimeScope = (context: object): object | undefined => {
  if (!('cloudflare' in context)) return undefined;
  const cloudflare = context.cloudflare;
  if (typeof cloudflare !== 'object' || cloudflare === null || !('context' in cloudflare)) return undefined;
  const scope = cloudflare.context;
  return typeof scope === 'object' && scope !== null ? scope : undefined;
};

/** Resolve the Nitro/Cloudflare lifecycle hook without assuming H3 v2 event methods. */
export const telemetryWaitUntil = (context: unknown): TelemetryWaitUntil | undefined => {
  if (typeof context !== 'object' || context === null) return undefined;
  const direct = waitUntilFromScope(context);
  if (direct !== undefined) return direct;
  const cloudflareScope = cloudflareLifetimeScope(context);
  return cloudflareScope === undefined ? undefined : waitUntilFromScope(cloudflareScope);
};
