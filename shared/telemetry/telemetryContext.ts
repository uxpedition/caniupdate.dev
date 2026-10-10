import { Predicate, Schema } from 'effect';

type TelemetryWaitUntil = (promise: Promise<unknown>) => void;

/**
 * Runtime container carrying lifecycle hooks: any string-keyed object (H3EventContext, a Nitro context, or one
 * carrying `cloudflare.context`). The record half keeps interface-typed callers assignable; hook fields stay
 * `unknown` until their callable check.
 */
const RuntimeContainerSchema = Schema.StructWithRest(
  Schema.Struct({
    waitUntil: Schema.optionalKey(Schema.Unknown),
    cloudflare: Schema.optionalKey(Schema.Unknown),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
);

type RuntimeContainer = typeof RuntimeContainerSchema.Type;

// Runtime fields are opaque; do not enumerate them or invoke unrelated getters to inspect a lifecycle hook.
const isRuntimeContainer = Schema.is(
  Schema.declare(
    (value: unknown): value is RuntimeContainer => Predicate.isObjectOrArray(value) || Predicate.isFunction(value),
  ),
);

type CloudflareBinding = { readonly context?: unknown };

const isCloudflareBinding = (value: unknown): value is CloudflareBinding =>
  Predicate.isObjectOrArray(value) || Predicate.isFunction(value);

const waitUntilFromScope = (scope: RuntimeContainer): TelemetryWaitUntil | undefined => {
  const waitUntil = scope.waitUntil;

  // oxlint-disable-next-line rules/no-runtime-typeof -- Platform-owned lifecycle hook: no schema can assert callability, only whichever container provides it.
  if (typeof waitUntil !== 'function') return undefined;

  return (promise) => {
    Reflect.apply(waitUntil, scope, [promise]);
  };
};

const cloudflareLifetimeScope = (context: RuntimeContainer): RuntimeContainer | undefined => {
  const cloudflare = context.cloudflare;

  if (cloudflare === null) throw new TypeError("Cannot read properties of null (reading 'context')");

  if (!isCloudflareBinding(cloudflare)) return undefined;

  const scope = cloudflare.context;

  return isRuntimeContainer(scope) ? scope : undefined;
};

/**
 * Resolve the Nitro/Cloudflare lifecycle hook without assuming H3 v2 event methods.
 * Accepts any string-keyed runtime container (H3 event context, or one carrying `cloudflare.context`); the
 * returned hook calls the original container's `waitUntil` with that container as receiver.
 */
export const telemetryWaitUntil = (context: RuntimeContainer): TelemetryWaitUntil | undefined => {
  if (!isRuntimeContainer(context)) return undefined;

  const direct = waitUntilFromScope(context);

  if (direct !== undefined) return direct;

  const cloudflareScope = cloudflareLifetimeScope(context);

  return cloudflareScope === undefined ? undefined : waitUntilFromScope(cloudflareScope);
};
