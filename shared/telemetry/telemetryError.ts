import { Schema } from 'effect';

const isScalarString = Schema.is(Schema.String);

type ErrorTypeName = 'Error' | 'TypeError' | 'RangeError' | 'ReferenceError' | 'SyntaxError' | 'URIError' | 'EvalError';

type ErrorSourceName =
  | 'browser'
  | 'vue'
  | 'app'
  | 'chunk'
  | 'server'
  | 'browser.vue'
  | 'browser.app'
  | 'browser.chunk'
  | 'browser.rejection'
  | 'browser.error'
  | 'browser.socket'
  | 'nuxt'
  | 'nuxt.ssr'
  | 'nuxt.vue'
  | 'evidence'
  | 'briefing'
  | 'platform';

/** Exhaustive over the union, so a new member cannot be added to the type without a table entry. */
const finiteTable =
  <T extends string>(table: Readonly<Record<T, true>>) =>
  (value: string): value is T =>
    Object.hasOwn(table, value);

const ERROR_TYPES: Readonly<Record<ErrorTypeName, true>> = {
  Error: true,
  TypeError: true,
  RangeError: true,
  ReferenceError: true,
  SyntaxError: true,
  URIError: true,
  EvalError: true,
};

const ERROR_SOURCES: Readonly<Record<ErrorSourceName, true>> = {
  browser: true,
  vue: true,
  app: true,
  chunk: true,
  server: true,
  'browser.vue': true,
  'browser.app': true,
  'browser.chunk': true,
  'browser.rejection': true,
  'browser.error': true,
  'browser.socket': true,
  nuxt: true,
  'nuxt.ssr': true,
  'nuxt.vue': true,
  evidence: true,
  briefing: true,
  platform: true,
};

const ERROR_KEYS: Readonly<Record<ErrorAttributeKey, true>> = {
  'exception.type': true,
  'exception.stacktrace': true,
  'error.source': true,
};

const isErrorTypeName = finiteTable(ERROR_TYPES);

const isErrorSourceName = finiteTable(ERROR_SOURCES);

const CODE_FILE = /^[A-Za-z0-9_.-]+\.(?:[cm]?js|tsx?|vue)$/;

export type ErrorAttributeKey = 'exception.type' | 'exception.stacktrace' | 'error.source';

export const isErrorAttributeKey = (key: string): key is ErrorAttributeKey => Object.hasOwn(ERROR_KEYS, key);

const readErrorString = (error: Error, key: 'name' | 'stack'): string | undefined => {
  try {
    const value: unknown = error[key];

    return isScalarString(value) ? value : undefined;
  } catch {
    return undefined;
  }
};

const normalizedStackTrace = (value: string): string | undefined => {
  const frames = value
    .split('\n')
    .slice(0, 20)
    .filter((frame) => /^[A-Za-z0-9_.-]+\.(?:[cm]?js|tsx?|vue):\d{1,9}:\d{1,9}$/.test(frame));

  return frames.length === 0 ? undefined : frames.join('\n').slice(0, 2_048);
};

/** Reviewed type, source and code-file stack fields only; exception prose is never exported. */
export const sanitizeErrorAttribute = (key: ErrorAttributeKey, value: string): string | undefined => {
  if (value.length > 16_384) return undefined;

  if (key === 'exception.type') return isErrorTypeName(value) ? value : 'Error';

  if (key === 'error.source') return isErrorSourceName(value) ? value : undefined;

  return normalizedStackTrace(value);
};

/** Reduce V8/JSC/SpiderMonkey stack lines to normalized code file locations; everything else is omitted. */
export const sanitizeErrorStack = (stack: string): string | undefined => {
  const frames: string[] = [];

  for (const line of (stack ?? '').split(/\r?\n/).slice(1, 21)) {
    const match = /(?:^|at\s+|@|\()(.+):(\d{1,9}):(\d{1,9})\)?$/.exec(line.trim());

    if (match?.[1] === undefined || match[2] === undefined || match[3] === undefined) continue;
    const frame = sanitizeErrorFrame(match[1], Number(match[2]), Number(match[3]));

    if (frame !== undefined) frames.push(frame);
  }

  return frames.length === 0 ? undefined : frames.join('\n');
};

/** Canonical sanitized attribute set for one diagnostic; unreviewed sources export nothing. */
export const sanitizedErrorAttributes = (
  source: string,
  cause: unknown,
): Partial<Record<ErrorAttributeKey, string>> | undefined => {
  const safeSource = sanitizeErrorAttribute('error.source', source);

  if (safeSource === undefined) return undefined;
  const attributes: Partial<Record<ErrorAttributeKey, string>> = { 'error.source': safeSource };

  if (!(cause instanceof Error)) {
    attributes['exception.type'] = 'Error';

    return attributes;
  }

  const safeType = sanitizeErrorAttribute('exception.type', readErrorString(cause, 'name') ?? 'Error');

  if (safeType !== undefined) attributes['exception.type'] = safeType;
  const safeStack = sanitizeErrorStack(readErrorString(cause, 'stack') ?? '');

  if (safeStack !== undefined) attributes['exception.stacktrace'] = safeStack;

  return attributes;
};

/** Faro owns parsing; retain only a code filename and coordinates, never URL or function metadata. */
const LOCATION_MAX = 999_999_999;

const boundedLocation = (axis: number, maximum: number): boolean =>
  Number.isSafeInteger(axis) && axis >= 1 && axis <= maximum;

export const sanitizeErrorFrame = (filename: string, line: number, column: number): string | undefined => {
  if (filename.length > 2_048 || /^(?:data|blob|javascript):/i.test(filename)) return undefined;

  if (!boundedLocation(line, LOCATION_MAX) || !boundedLocation(column, LOCATION_MAX)) return undefined;
  const file = filename.split(/[?#]/, 1)[0]?.split(/[\\/]/).pop();

  if (file === undefined || !CODE_FILE.test(file)) return undefined;

  return `${file}:${line}:${column}`;
};
