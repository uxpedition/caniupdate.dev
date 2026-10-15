import { describe, expect, it } from 'vitest';

import {
  sanitizeErrorAttribute,
  sanitizeErrorFrame,
  sanitizeErrorStack,
  sanitizedErrorAttributes,
} from './telemetryError';

// Removing either source-side or ingress scrubbing would expose these markers.
describe('error diagnostic privacy', () => {
  it('never reads raw error messages or opaque causes', () => {
    const failure = new TypeError('RAW_PROSE_MARKER');
    Object.defineProperty(failure, 'message', {
      get: () => {
        throw new Error('message must not be read');
      },
    });
    failure.stack = 'TypeError: RAW_PROSE_MARKER';
    expect(sanitizedErrorAttributes('nuxt', failure)).toEqual({
      'error.source': 'nuxt',
      'exception.type': 'TypeError',
    });
    expect(JSON.stringify(sanitizedErrorAttributes('nuxt', { message: 'OPAQUE_MARKER' }))).not.toContain(
      'OPAQUE_MARKER',
    );
  });

  it('keeps asset locations without page origins, query fields, function names or local filesystem roots', () => {
    expect(sanitizeErrorFrame('https://site.example/_nuxt/comparison.abc.js?email=alice@example.com', 42, 7)).toBe(
      'comparison.abc.js:42:7',
    );
    expect(sanitizeErrorFrame('/home/alice/project/server/render.ts', 13, 2)).toBe('render.ts:13:2');
    expect(sanitizeErrorFrame('data:text/javascript,private-marker', 1, 1)).toBeUndefined();
    expect(sanitizeErrorFrame('https://site.example/alice@example.com.js', 1, 1)).toBeUndefined();
  });

  it('does not export arbitrary exception classifications or unreviewed sources', () => {
    expect(sanitizeErrorAttribute('exception.type', 'alice@example.com')).toBe('Error');
    expect(sanitizeErrorAttribute('exception.type', 'TypeError')).toBe('TypeError');
    expect(sanitizeErrorAttribute('error.source', 'provider-response-secret')).toBeUndefined();
  });

  it('normalizes browser and node stacks into code file frames only', () => {
    expect(
      sanitizeErrorStack(
        'TypeError: private marker\n    at https://site.example/_nuxt/chunk.abc.ts:42:7\n    at native:1:1',
      ),
    ).toBe('chunk.abc.ts:42:7');
    expect(
      sanitizeErrorStack(
        'Error: failed\n    at Object.<anonymous> (file:///home/alice/project/server/render.ts:12:34)',
      ),
    ).toBe('render.ts:12:34');
    expect(sanitizeErrorStack('at /home/alice/server/only-location.ts:5:6')).toBeUndefined();
    expect(sanitizeErrorStack('TypeError: without frames')).toBeUndefined();
  });

  it('builds server attributes from reviewed error fields only', () => {
    const failure = new TypeError('SSR failed for frida@example.com Authorization: Bearer fixture-secret');
    failure.stack = 'TypeError: SSR failed\n    at file:///worker/server/render.vue:9:10';
    expect(sanitizedErrorAttributes('nuxt.ssr', failure)).toEqual({
      'error.source': 'nuxt.ssr',
      'exception.type': 'TypeError',
      'exception.stacktrace': 'render.vue:9:10',
    });
    expect(sanitizedErrorAttributes('nuxt', 'private opaque value')).toEqual({
      'error.source': 'nuxt',
      'exception.type': 'Error',
    });
    expect(sanitizedErrorAttributes('provider-response-secret', new Error('failed'))).toBeUndefined();
  });
});
