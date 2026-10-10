const ERROR_TYPES: Readonly<Record<string, true>> = {
  Error: true,
  TypeError: true,
  RangeError: true,
  ReferenceError: true,
  SyntaxError: true,
  URIError: true,
  EvalError: true,
};

const ERROR_SOURCES: Readonly<Record<string, true>> = {
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

const ERROR_KEYS: Readonly<Record<string, true>> = {
  'exception.type': true,
  'exception.message': true,
  'exception.stacktrace': true,
  'error.source': true,
};

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

const URL = /(?:https?|file):\/\/[^\s)"'<>]+/gi;

const AUTH = /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;

const CREDENTIAL =
  /\b(?:authorization|cookie|set-cookie|password|api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|client[_-]?secret|credentials|auth)["']?\s*[:=]\s*["']?[^\s;,"']+/gi;

const TOKEN = /\b(?:npm_[A-Za-z0-9]+|gh[pousr]_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+)\b/g;

const JWT = /\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;

const CODE_FILE = /^[A-Za-z0-9_.-]+\.(?:[cm]?js|tsx?|vue)$/;

export type ErrorAttributeKey = 'exception.type' | 'exception.message' | 'exception.stacktrace' | 'error.source';

export const isErrorAttributeKey = (key: string): key is ErrorAttributeKey => Object.hasOwn(ERROR_KEYS, key);

const readErrorString = (error: Error, key: 'name' | 'message' | 'stack'): string | undefined => {
  try {
    const value: unknown = Reflect.get(error, key);

    return typeof value === 'string' ? value : undefined;
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

/** Only reviewed exception fields enter telemetry; regex scrubbing is not universal PII detection. */
export const sanitizeErrorAttribute = (key: ErrorAttributeKey, value: string): string | undefined => {
  if (value.length > 16_384) return undefined;

  if (key === 'exception.type') return Object.hasOwn(ERROR_TYPES, value) ? value : 'Error';

  if (key === 'error.source') return Object.hasOwn(ERROR_SOURCES, value) ? value : undefined;

  if (key === 'exception.stacktrace') return normalizedStackTrace(value);

  return value
    .replace(URL, '[REDACTED]')
    .replace(AUTH, '[REDACTED]')
    .replace(CREDENTIAL, '[REDACTED]')
    .replace(TOKEN, '[REDACTED]')
    .replace(JWT, '[REDACTED]')
    .replace(EMAIL, '[REDACTED]')
    .slice(0, 1_024);
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
export const sanitizedErrorAttributes = (source: string, error: unknown): Record<string, string> | undefined => {
  const safeSource = sanitizeErrorAttribute('error.source', source);

  if (safeSource === undefined) return undefined;
  const attributes: Record<string, string> = { 'error.source': safeSource };

  if (!(error instanceof Error)) {
    attributes['exception.type'] = 'Error';

    return attributes;
  }

  const safeType = sanitizeErrorAttribute('exception.type', readErrorString(error, 'name') ?? 'Error');

  if (safeType !== undefined) attributes['exception.type'] = safeType;
  const message = readErrorString(error, 'message');

  if (message !== undefined) {
    const safeMessage = sanitizeErrorAttribute('exception.message', message);

    if (safeMessage !== undefined) attributes['exception.message'] = safeMessage;
  }

  const safeStack = sanitizeErrorStack(readErrorString(error, 'stack') ?? '');

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
