import type { Page, Request } from 'playwright';

import type { SmokeConfig } from './config.ts';

export type BrowserDiagnostic = {
  kind: 'console-error' | 'page-error';
  message: string;
  source?: string;
  line?: number;
  column?: number;
  stack?: string;
};

export type BrowserDiagnostics = {
  total: number;
  entries: BrowserDiagnostic[];
  networkTotal?: number;
  network?: BrowserNetworkDiagnostic[];
};

export type BrowserNetworkDiagnostic = {
  kind: 'request-failed' | 'http-error';
  url: string;
  page: string;
  method: string;
  resourceType: string;
  reason: string;
  status?: number;
};

function sanitizeSource(source: string): string {
  try {
    const url = new URL(source);

    if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) return '[non-http-url]';

    return `${url.origin}${url.pathname}`;
  } catch {
    return '[unavailable-source]';
  }
}

function sanitizeMessage(message: string, config: SmokeConfig): string {
  let sanitized = message;

  for (const secret of Object.values(config.accessHeaders)) {
    if (secret === '') continue;
    sanitized = sanitized.replaceAll(secret, '[redacted]').replaceAll(encodeURIComponent(secret), '[redacted]');
  }

  return sanitized
    .replace(/\p{Cc}\[[0-?]*[ -/]*[@-~]/gu, '')
    .replace(/\p{Cc}/gu, ' ')
    .replace(/(?:https?|wss?|file|data|blob):[^\s"'<>)]*/g, (source) => {
      const position = source.match(/:\d+:\d+$/)?.[0] ?? '';
      const url = position === '' ? source : source.slice(0, -position.length);

      return sanitizeSource(url) + position;
    })
    .replace(/\b(?:Bearer|Basic)\s+[^\s,;]+/gi, '[redacted-authorization]')
    .replace(
      /\b(?:authorization|cookie|set-cookie|cf-access-client-id|cf-access-client-secret|api[_-]?key|token|password|secret|prompt|evidence)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      '[redacted]',
    )
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted-email]')
    .replace(/\{[\s\S]*|\[(?:\s*["{])[\s\S]*/g, '[structured-data]')
    .replace(/\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted-token]')
    .slice(0, 1000);
}

export function recordBrowserError(
  diagnostics: BrowserDiagnostics,
  config: SmokeConfig,
  error: BrowserDiagnostic,
): void {
  diagnostics.total += 1;

  if (diagnostics.entries.length >= 20) return;

  const entry: BrowserDiagnostic = { kind: error.kind, message: sanitizeMessage(error.message, config) };

  if (error.source) entry.source = sanitizeMessage(sanitizeSource(error.source), config);

  if (error.line !== undefined) entry.line = error.line;

  if (error.column !== undefined) entry.column = error.column;

  if (error.stack)
    entry.stack = error.stack
      .split('\n')
      .slice(0, 12)
      .map((line) => sanitizeMessage(line, config))
      .join('\n');
  diagnostics.entries.push(entry);
}

export function recordBrowserNetwork(
  diagnostics: BrowserDiagnostics,
  config: SmokeConfig,
  event: BrowserNetworkDiagnostic,
): void {
  diagnostics.networkTotal = (diagnostics.networkTotal ?? 0) + 1;
  diagnostics.network ??= [];

  if (diagnostics.network.length >= 50) return;

  const entry: BrowserNetworkDiagnostic = {
    kind: event.kind,
    url: sanitizeMessage(sanitizeSource(event.url), config),
    page: sanitizeMessage(sanitizeSource(event.page), config),
    method: event.method,
    resourceType: event.resourceType,
    reason: sanitizeMessage(event.reason, config),
  };

  if (event.status !== undefined) entry.status = event.status;
  diagnostics.network.push(entry);
}

function captureBrowserNetwork(page: Page, config: SmokeConfig, diagnostics: BrowserDiagnostics): void {
  const record = (request: Request, kind: BrowserNetworkDiagnostic['kind'], reason: string, status?: number) => {
    const event: BrowserNetworkDiagnostic = {
      kind,
      url: request.url(),
      page: page.url(),
      method: request.method(),
      resourceType: request.resourceType(),
      reason,
    };

    if (status !== undefined) event.status = status;
    recordBrowserNetwork(diagnostics, config, event);
  };

  page.on('requestfailed', (request) => {
    const url = new URL(request.url());
    const blocked = url.origin !== config.frontendOrigin.origin && url.origin !== config.socketHttpOrigin;
    const failure = request.failure()?.errorText ?? 'Request failed without a browser error message';
    record(request, 'request-failed', blocked ? `Smoke origin policy blocked request: ${failure}` : failure);
  });
  page.on('response', (response) => {
    if (response.status() >= 400) record(response.request(), 'http-error', response.statusText(), response.status());
  });
}

export function captureBrowserErrors(page: Page, config: SmokeConfig, diagnostics: BrowserDiagnostics): void {
  captureBrowserNetwork(page, config, diagnostics);
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const location = message.location();
    recordBrowserError(diagnostics, config, {
      kind: 'console-error',
      message: message.text(),
      source: location.url,
      line: location.line + 1,
      column: location.column + 1,
    });
  });
  page.on('pageerror', (error) => {
    const frame = error.stack?.slice(error.stack.indexOf('\n') + 1).match(/(https?:\/\/[^\s)]+):(\d+):(\d+)/);
    const entry: BrowserDiagnostic = { kind: 'page-error', message: `${error.name}: ${error.message}` };

    if (error.stack) entry.stack = error.stack;

    if (frame) {
      entry.source = frame[1];
      entry.line = Number(frame[2]);
      entry.column = Number(frame[3]);
    }

    recordBrowserError(diagnostics, config, entry);
  });
}
