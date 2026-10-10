import type * as Cloudflare from '@cloudflare/workers-types';
import { DurableObject } from 'cloudflare:workers';
import { Schema } from 'effect';

import type { ComparisonEvidenceCacheOptions } from '../../../server/comparison/evidence/services';
import { SqlEvidenceCache } from '../store';
import {
  type CacheFixtureCoalesced,
  type CacheFixtureCommand,
  CacheFixtureCommandSchema,
  type CacheFixtureError,
  type CacheFixtureOutcome,
} from './cache.protocol';

type Request = Cloudflare.Request;

type Response = Cloudflare.Response;

declare const Response: typeof Cloudflare.Response;

const CHUNK_BYTES = 128 * 1024;

const decodeCacheFixtureCommand = Schema.decodeUnknownSync(CacheFixtureCommandSchema, { errors: 'all' });

const isContainerObject = Schema.is(Schema.Struct({}));

const isScalarString = Schema.is(Schema.String);

const isSelfContainer = Schema.is(Schema.Struct({ self: Schema.Unknown }));

// Self-referential probe: JSON.stringify throws on it, exercising the serialization-failure path.
type SelfReferentialProbe = { self?: unknown };

// `undefined` is the unserializable-value probe; every other member is a fixture operation's result.
type FixtureResult =
  | { initialized: true }
  | { cleaned: true }
  | string
  | undefined
  | CacheFixtureCoalesced
  | SelfReferentialProbe;

type FixtureEnvelope =
  | { ok: true; value: FixtureResult; loaderCalls: number }
  | { ok: false; error: CacheFixtureError; loaderCalls: number };

type FixtureResponseBody = FixtureEnvelope | { error: CacheFixtureError };

function jsonResponse(body: FixtureResponseBody, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function stringProperty(cause: unknown, key: string): string | undefined {
  if (!isContainerObject(cause) || !(key in cause)) return undefined;
  const property: unknown = Reflect.get(cause, key);

  return isScalarString(property) ? property : undefined;
}

type CauseLeaf = { name: string | undefined; message: string | undefined };

// Walks native `Error.cause` links to the innermost container and projects only its validated name and message.
// Cycles, primitive links, missing causes, and DrizzleQueryError leaves yield no leaf.
function innermostCause(cause: unknown): CauseLeaf | undefined {
  if (!isContainerObject(cause)) return undefined;
  let current: unknown = Reflect.get(cause, 'cause');

  if (current === undefined) return undefined;
  const seen = new Set<object>();

  while (isContainerObject(current)) {
    if (seen.has(current)) return undefined;
    seen.add(current);
    const nested: unknown = Reflect.get(current, 'cause');

    if (nested === undefined) {
      if (stringProperty(current, 'name') === 'DrizzleQueryError') return undefined;

      return { name: stringProperty(current, 'name'), message: stringProperty(current, 'message') };
    }

    current = nested;
  }

  return undefined;
}

function sanitizeError(cause: unknown): CacheFixtureError {
  const operation = stringProperty(cause, 'operation');
  const detail = stringProperty(cause, 'detail');
  const leaf = innermostCause(cause);
  const causeName = leaf?.name;
  const causeMessage = leaf?.message;

  const error: CacheFixtureError = { _tag: stringProperty(cause, '_tag') ?? 'UnknownError' };

  if (operation !== undefined) error.operation = operation;

  if (detail !== undefined) error.detail = detail;

  if (causeName !== undefined) error.causeName = causeName;

  if (causeMessage !== undefined) error.causeMessage = causeMessage;

  return error;
}

async function captureOutcome(promise: Promise<string>): Promise<CacheFixtureOutcome> {
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

  private async execute(command: CacheFixtureCommand): Promise<FixtureResult> {
    switch (command.operation) {
      case 'initialize':
        void this.cacheClient;

        return { initialized: true };
      case 'load': {
        const options: ComparisonEvidenceCacheOptions<string> = {
          ttlMs: command.ttlMs,
          cacheable: () => command.cacheable,
          isValid: (value: unknown): value is string => command.validation === 'string' && isScalarString(value),
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
          isValid: (value: unknown): value is string => isScalarString(value),
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

  private async coalesce(
    command: Extract<CacheFixtureCommand, { operation: 'coalesce' }>,
  ): Promise<CacheFixtureCoalesced> {
    let releaseLoader: ((value: string) => void) | undefined;

    const deferred = new Promise<string>((resolve) => {
      releaseLoader = resolve;
    });

    const firstOptions: ComparisonEvidenceCacheOptions<string> = {
      ttlMs: null,
      cacheable: () => true,
      isValid: (value: unknown): value is string => isScalarString(value),
    };

    const secondOptions: ComparisonEvidenceCacheOptions<string> = {
      ttlMs: null,
      cacheable: () => true,
      isValid: (value: unknown): value is string => !command.rejectSecond && isScalarString(value),
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

  private async serialize(
    command: Extract<CacheFixtureCommand, { operation: 'serialization' }>,
  ): Promise<FixtureResult> {
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

    const value: SelfReferentialProbe = {};
    value.self = value;

    const options: ComparisonEvidenceCacheOptions<SelfReferentialProbe> = {
      ttlMs: null,
      cacheable: () => true,
      isValid: (candidate: unknown): candidate is SelfReferentialProbe =>
        isSelfContainer(candidate) && 'self' in candidate,
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
