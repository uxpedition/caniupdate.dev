import type * as Cloudflare from '@cloudflare/workers-types';
import { DurableObject } from 'cloudflare:workers';
import { Schema } from 'effect';

import type { ComparisonEvidenceCacheOptions } from '../../../server/comparison/evidence/services';
import { SqlEvidenceCache } from '../store';

type Request = Cloudflare.Request;

type Response = Cloudflare.Response;

declare const Response: typeof Cloudflare.Response;

const CHUNK_BYTES = 128 * 1024;

export type CacheFixtureCommand =
  | { operation: 'initialize' }
  | {
      operation: 'load';
      key: string;
      value: string;
      ttlMs: number | null;
      cacheable: boolean;
      validation: 'string' | 'reject';
    }
  | { operation: 'cleanup'; now: number }
  | { operation: 'load-replacing'; key: string; value: string; oldValue: string; ttlMs: number | null }
  | { operation: 'coalesce'; key: string; value: string; rejectSecond: boolean }
  | { operation: 'serialization'; key: string; kind: 'undefined' | 'circular' };

type SanitizedError = {
  _tag: string;
  operation?: string;
  detail?: string;
  causeName?: string;
  causeMessage?: string;
};

type CacheOutcome = { ok: true; value: string } | { ok: false; error: SanitizedError };

const TtlMsSchema = Schema.NullOr(Schema.Finite);

const CacheFixtureCommandSchema = Schema.Union([
  Schema.Struct({ operation: Schema.Literal('initialize') }),
  Schema.Struct({
    operation: Schema.Literal('load'),
    key: Schema.String,
    value: Schema.String,
    ttlMs: TtlMsSchema,
    cacheable: Schema.Boolean,
    validation: Schema.Literals(['string', 'reject']),
  }),
  Schema.Struct({ operation: Schema.Literal('cleanup'), now: Schema.Finite }),
  Schema.Struct({
    operation: Schema.Literal('load-replacing'),
    key: Schema.String,
    value: Schema.String,
    oldValue: Schema.String,
    ttlMs: TtlMsSchema,
  }),
  Schema.Struct({
    operation: Schema.Literal('coalesce'),
    key: Schema.String,
    value: Schema.String,
    rejectSecond: Schema.Boolean,
  }),
  Schema.Struct({
    operation: Schema.Literal('serialization'),
    key: Schema.String,
    kind: Schema.Literals(['undefined', 'circular']),
  }),
]);

const decodeCacheFixtureCommand = Schema.decodeUnknownSync(CacheFixtureCommandSchema, { errors: 'all' });

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function stringProperty(value: unknown, key: string): string | undefined {
  if (typeof value !== 'object' || value === null || !(key in value)) return undefined;
  const property: unknown = Reflect.get(value, key);

  return typeof property === 'string' ? property : undefined;
}

function innermostCause(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return undefined;
  let current: unknown = Reflect.get(value, 'cause');

  if (current === undefined) return undefined;
  const seen = new Set<object>();

  while (typeof current === 'object' && current !== null) {
    if (seen.has(current)) return undefined;
    seen.add(current);
    const nested: unknown = Reflect.get(current, 'cause');

    if (nested === undefined) {
      return stringProperty(current, 'name') === 'DrizzleQueryError' ? undefined : current;
    }

    current = nested;
  }

  return current;
}

function sanitizeError(cause: unknown): SanitizedError {
  const error: SanitizedError = {
    _tag: stringProperty(cause, '_tag') ?? 'UnknownError',
  };

  const operation = stringProperty(cause, 'operation');
  const detail = stringProperty(cause, 'detail');
  const innermost = innermostCause(cause);
  const causeName = stringProperty(innermost, 'name');
  const causeMessage = stringProperty(innermost, 'message');

  if (operation !== undefined) error.operation = operation;

  if (detail !== undefined) error.detail = detail;

  if (causeName !== undefined) error.causeName = causeName;

  if (causeMessage !== undefined) error.causeMessage = causeMessage;

  return error;
}

async function captureOutcome(promise: Promise<string>): Promise<CacheOutcome> {
  try {
    return { ok: true, value: await promise };
  } catch (cause) {
    return { ok: false, error: sanitizeError(cause) };
  }
}

export class EvidenceCacheFixture extends DurableObject {
  private cache: SqlEvidenceCache | undefined = undefined;
  private loaderCalls = 0;

  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return jsonResponse({ ok: false, loaderCalls: this.loaderCalls, error: { _tag: 'FixtureRequestError' } }, 405);
    }

    let requestBody: unknown;

    try {
      requestBody = await request.json();
    } catch {
      return jsonResponse({ ok: false, loaderCalls: this.loaderCalls, error: { _tag: 'FixtureRequestError' } }, 400);
    }

    let command: CacheFixtureCommand;

    try {
      command = decodeCacheFixtureCommand(requestBody);
    } catch {
      return jsonResponse({ ok: false, loaderCalls: this.loaderCalls, error: { _tag: 'FixtureRequestError' } }, 400);
    }

    try {
      const value = await this.execute(command);

      return jsonResponse({ ok: true, value, loaderCalls: this.loaderCalls });
    } catch (cause) {
      return jsonResponse({ ok: false, error: sanitizeError(cause), loaderCalls: this.loaderCalls });
    }
  }

  private get cacheClient(): SqlEvidenceCache {
    if (this.cache === undefined) this.cache = new SqlEvidenceCache(this.ctx.storage);

    return this.cache;
  }

  private async execute(command: CacheFixtureCommand): Promise<unknown> {
    switch (command.operation) {
      case 'initialize':
        void this.cacheClient;

        return { initialized: true };
      case 'load': {
        const options: ComparisonEvidenceCacheOptions<string> = {
          ttlMs: command.ttlMs,
          cacheable: () => command.cacheable,
          isValid: (value: unknown): value is string => command.validation === 'string' && typeof value === 'string',
        };

        return await this.cacheClient.load(
          command.key,
          async () => {
            this.loaderCalls += 1;

            return command.value;
          },
          options,
        );
      }

      case 'cleanup':
        this.cacheClient.cleanupExpired(command.now);

        return { cleaned: true };
      case 'load-replacing': {
        const options: ComparisonEvidenceCacheOptions<string> = {
          ttlMs: command.ttlMs,
          cacheable: () => true,
          isValid: (value: unknown): value is string => typeof value === 'string',
        };

        return await this.cacheClient.load(
          command.key,
          async () => {
            this.loaderCalls += 1;
            this.insertOldValue(command.key, command.oldValue);

            return command.value;
          },
          options,
        );
      }

      case 'coalesce':
        return await this.coalesce(command);
      case 'serialization':
        return await this.serialize(command);
    }
  }

  private async coalesce(command: Extract<CacheFixtureCommand, { operation: 'coalesce' }>): Promise<unknown> {
    let releaseLoader: ((value: string) => void) | undefined;

    const deferred = new Promise<string>((resolve) => {
      releaseLoader = resolve;
    });

    const firstOptions: ComparisonEvidenceCacheOptions<string> = {
      ttlMs: null,
      cacheable: () => true,
      isValid: (value: unknown): value is string => typeof value === 'string',
    };

    const secondOptions: ComparisonEvidenceCacheOptions<string> = {
      ttlMs: null,
      cacheable: () => true,
      isValid: (value: unknown): value is string => !command.rejectSecond && typeof value === 'string',
    };

    const first = this.cacheClient.load(
      command.key,
      async () => {
        this.loaderCalls += 1;

        return await deferred;
      },
      firstOptions,
    );

    const second = this.cacheClient.load(
      command.key,
      async () => {
        this.loaderCalls += 1;

        return command.value;
      },
      secondOptions,
    );

    if (releaseLoader === undefined) throw new Error('Deferred evidence loader was not initialized');
    releaseLoader(command.value);

    return {
      first: await captureOutcome(first),
      second: await captureOutcome(second),
    };
  }

  private async serialize(command: Extract<CacheFixtureCommand, { operation: 'serialization' }>): Promise<unknown> {
    if (command.kind === 'undefined') {
      const options: ComparisonEvidenceCacheOptions<undefined> = {
        ttlMs: null,
        cacheable: () => true,
        isValid: (value: unknown): value is undefined => value === undefined,
      };

      return await this.cacheClient.load(
        command.key,
        async () => {
          this.loaderCalls += 1;

          return undefined;
        },
        options,
      );
    }

    const value: { self?: unknown } = {};
    value.self = value;

    const options: ComparisonEvidenceCacheOptions<{ self?: unknown }> = {
      ttlMs: null,
      cacheable: () => true,
      isValid: (candidate: unknown): candidate is { self?: unknown } =>
        typeof candidate === 'object' && candidate !== null && 'self' in candidate,
    };

    return await this.cacheClient.load(
      command.key,
      async () => {
        this.loaderCalls += 1;

        return value;
      },
      options,
    );
  }

  private insertOldValue(key: string, oldValue: string): void {
    const serialized = JSON.stringify(oldValue);

    if (serialized === undefined) throw new TypeError('Fixture value cannot be serialized');
    const chunks: string[] = [];

    for (let start = 0; start < serialized.length; start += CHUNK_BYTES) {
      chunks.push(serialized.slice(start, start + CHUNK_BYTES));
    }

    this.ctx.storage.sql.exec(
      'INSERT INTO evidence_records (key, expires_at, chunk_count, byte_length) VALUES (?, ?, ?, ?)',
      key,
      null,
      chunks.length,
      new TextEncoder().encode(serialized).byteLength,
    );

    for (const [chunkIndex, payload] of chunks.entries()) {
      this.ctx.storage.sql.exec(
        'INSERT INTO evidence_chunks (key, chunk_index, payload) VALUES (?, ?, ?)',
        key,
        chunkIndex,
        payload,
      );
    }
  }
}

export default {
  async fetch(): Promise<Response> {
    return jsonResponse({ error: { _tag: 'FixtureRouteUnavailable' } }, 404);
  },
};
