import { Predicate, Schema } from 'effect';

import type { DisposableBriefingServiceResult, DisposableStoredBriefingResult } from '#shared/cloudflare';

type RpcResultData = typeof RpcResultDataSchema.Type;

type DisposableRpcResult = RpcResultData & { [Symbol.dispose](): void };

const RpcResultDataSchema = Schema.Record(Schema.String, Schema.Unknown);

const isScalarString = Schema.is(Schema.String);

// Cloudflare adds this documented lifecycle hook to each returned object; application fields still pass the strict
// decoder supplied by the caller.
const isDisposableRpcResult = (value: unknown): value is DisposableRpcResult =>
  Predicate.isObjectOrArray(value) &&
  Predicate.isFunction(Object.getOwnPropertyDescriptor(value, Symbol.dispose)?.value);

// Only objects, arrays, and Miniflare's function-backed RPC proxies carry own keys; reject primitives before listing.
const isRpcResultObject = (value: unknown): value is RpcResultData =>
  Predicate.isObjectOrArray(value) || Predicate.isFunction(value);

// Copy every own application key, including non-enumerable ones, so strict decoding rejects undeclared data. The
// documented disposer is excluded because the caller invokes it unconditionally.
const copyRpcServiceResultData = (result: RpcResultData): RpcResultData => {
  const data: RpcResultData = {};

  for (const key of Reflect.ownKeys(result)) {
    if (key === Symbol.dispose) continue;

    if (!isScalarString(key)) throw new TypeError('Service returned an unexpected symbol');

    const descriptor = Object.getOwnPropertyDescriptor(result, key);

    if (descriptor === undefined || !('value' in descriptor)) {
      throw new TypeError('Service returned an accessor property');
    }

    Object.defineProperty(data, key, { enumerable: true, value: descriptor.value });
  }

  return data;
};

// Node's Miniflare bridge omits descriptor values while keeping ordinary property reads live. Built Workers retain
// the descriptor-only path above and require Cloudflare's documented lifecycle hook.
const copyNodeDevelopmentRpcServiceResultData = (result: RpcResultData): RpcResultData => {
  const data: RpcResultData = {};

  for (const key of Reflect.ownKeys(result)) {
    if (!isScalarString(key)) throw new TypeError('Service returned an unexpected symbol');

    const descriptor = Object.getOwnPropertyDescriptor(result, key);

    if (descriptor === undefined || descriptor.writable === undefined) {
      throw new TypeError('Service returned an accessor property');
    }

    const value: unknown = result[key];
    Object.defineProperty(data, key, { enumerable: true, value });
  }

  return data;
};

/** Receive a private native RPC value, invoke its disposer, and strictly decode only its application fields. */
export const receiveServiceRpcResult = async <T>(
  invoke: () => Promise<DisposableBriefingServiceResult | DisposableStoredBriefingResult>,
  decode: (value: RpcResultData) => T,
): Promise<T> => {
  const rpcResult: unknown = await invoke();

  if (isDisposableRpcResult(rpcResult)) {
    const dispose = rpcResult[Symbol.dispose];

    try {
      return decode(copyRpcServiceResultData(rpcResult));
    } finally {
      dispose.call(rpcResult);
    }
  }

  // Nuxt's Node development bridge hides symbol keys on Miniflare proxies; the built Worker never takes this branch.
  if (import.meta.dev) {
    if (!isRpcResultObject(rpcResult)) throw new TypeError('Service did not return an object');

    return decode(copyNodeDevelopmentRpcServiceResultData(rpcResult));
  }

  throw new TypeError('Service did not return a disposable object');
};
