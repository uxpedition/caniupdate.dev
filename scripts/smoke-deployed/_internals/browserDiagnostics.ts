import type { Page } from 'playwright';

import type { SmokeConfig } from './config.ts';

export type BrowserDiagnostic = {
  kind: 'console-error' | 'page-error';
  message: string;
  source?: string;
  line?: number;
  column?: number;
};

export type BrowserDiagnostics = {
  total: number;
  entries: BrowserDiagnostic[];
};

function sanitizeSource(source: string, config: SmokeConfig): string {
  try {
    const url = new URL(source);

    if (
      url.origin !== config.frontendOrigin.origin &&
      url.origin !== config.socketOrigin.origin &&
      url.origin !== config.socketHttpOrigin
    ) {
      return '[external-url]';
    }

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
    .replace(/(?:https?|wss?|file|data|blob):[^\s"'<>)]*/g, (source) => sanitizeSource(source, config))
    .replace(/\b(?:Bearer|Basic)\s+[^\s,;]+/gi, '[redacted-authorization]')
    .replace(
      /\b(?:authorization|cookie|set-cookie|cf-access-client-id|cf-access-client-secret|api[_-]?key|token|password|secret|prompt|evidence)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      '[redacted]',
    )
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted-email]')
    .replace(/\{[\s\S]*|\[(?:\s*["{])[\s\S]*/g, '[structured-data]')
    .replace(/[A-Za-z0-9+/_=-]{32,}/g, '[redacted]')
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

  if (error.source) entry.source = sanitizeMessage(sanitizeSource(error.source, config), config);

  if (error.line !== undefined) entry.line = error.line;

  if (error.column !== undefined) entry.column = error.column;
  diagnostics.entries.push(entry);
}

export function captureBrowserErrors(page: Page, config: SmokeConfig, diagnostics: BrowserDiagnostics): void {
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

    if (frame) {
      entry.source = frame[1];
      entry.line = Number(frame[2]);
      entry.column = Number(frame[3]);
    }

    recordBrowserError(diagnostics, config, entry);
  });
}
