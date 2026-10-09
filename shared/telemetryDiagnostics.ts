import { Effect } from 'effect';
import type { H3Event } from 'h3';

import { runWithTelemetry } from '#shared/telemetry';
import { telemetryWaitUntil } from '#shared/telemetryContext';
import { sanitizedErrorAttributes } from '#shared/telemetryError';

export type ServerTelemetryBaseConfig = {
  readonly enabled: boolean;
  readonly endpoint: string;
  readonly headers: Record<string, string>;
};

export type ServerDiagnosticBody = 'runtime.error' | 'runtime.warning';
export type ServerDiagnosticSend = (body: ServerDiagnosticBody, attributes: Record<string, string>) => Promise<void>;

/** One diagnostic export per owned (request, error) pair; capacity and privacy live in send and shared policy. */
const diagnosticOwnership = new WeakMap<H3Event, WeakSet<Error>>();

const markServerDiagnosticOwned = (event: H3Event, error: Error): boolean => {
  let seen = diagnosticOwnership.get(event);
  if (seen === undefined) {
    seen = new WeakSet();
    diagnosticOwnership.set(event, seen);
  }
  if (seen.has(error)) return false;
  seen.add(error);
  return true;
};

/** Telemetry recursion, expected client outcomes and aborted requests are not diagnostics. */
export const isServerDiagnosticReportable = (event: H3Event, error: unknown, status: number | undefined): boolean => {
  if (new URL(event.path ?? '/', 'http://localhost').pathname.startsWith('/api/telemetry')) return false;
  if (status !== undefined && status < 500) return false;
  if (error instanceof Error && error.name === 'AbortError') return false;
  return true;
};

/** Bounded short-lived runtime; a disabled sink quietly drops, a failing sink never rejects the request. */
export const createServerDiagnosticSend =
  (event: H3Event, telemetry: ServerTelemetryBaseConfig): ServerDiagnosticSend =>
  async (body, attributes) => {
    if (!telemetry.enabled || telemetry.endpoint.trim() === '') return;
    await runWithTelemetry(
      (body === 'runtime.error' ? Effect.logError(body) : Effect.logWarning(body)).pipe(
        Effect.annotateLogs(attributes),
      ),
      {
        serviceName: 'can-i-update-nuxt',
        endpoint: telemetry.endpoint,
        headers: telemetry.headers,
      },
      telemetryWaitUntil(event.context),
    ).catch((error) => {
      console.error('smoke-diag-send-failure', error);
    });
  };

export type ServerDiagnosticReportOptions = {
  readonly send: ServerDiagnosticSend;
  readonly body: ServerDiagnosticBody;
  readonly source: string;
  readonly error: unknown;
  readonly status?: number;
};

/** Classify, own, sanitize, emit; every step must not disturb the application outcome it observes. */
export const reportServerDiagnostic = async (event: H3Event, options: ServerDiagnosticReportOptions): Promise<void> => {
  const { send, body, source, error, status } = options;
  if (!isServerDiagnosticReportable(event, error, status)) return;
  if (status === undefined && error === undefined) return;
  if (error instanceof Error && !markServerDiagnosticOwned(event, error)) return;
  const attributes = sanitizedErrorAttributes(source, error);
  if (attributes === undefined) return;
  try {
    await send(body, attributes);
  } catch {
    // A closed diagnostic sink must not alter the request it observed.
  }
};
