// The provider stub: a real OpenAI-compatible endpoint on loopback, the payload it answers with, and the evidence
// identity its canned citations point at. Its request count is the paid-call counter every suite asserts against, and
// its modes are the faults those suites inject: invalid output, an HTTP failure, or a stalled response.
//
// A `.stub.ts` because it impersonates an external system; the `*.unit.ts` suffix is reserved for suites.

import { once } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { Schema } from 'effect';

const isScalarString = Schema.is(Schema.String);

export const MODEL = 'test-model';

export const FIXTURE_API_KEY = 'fixture-key';

const PROVIDER_PATH = '/v1/chat/completions';

/** The evidence id the fixture packet carries at position one; the canned answer cites that position. */
export const SOURCE_ID = 'comparison.node';

export const SOURCE_NUMBER = 1;

export const validBullets = [
  {
    kind: 'migration',
    basis: 'inference',
    text: 'The target declares Node >=20; update Node 18 runtimes before upgrading.',
    evidenceNumbers: [SOURCE_NUMBER],
  },
];

/** The same citation as the stored response reports it: the kept source renumbered to display position zero. */
export const responseBullets = validBullets.map((bullet) => ({ ...bullet, evidenceNumbers: [0] }));

export type ProviderMode =
  | { readonly kind: 'valid' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'http-error' }
  | { readonly kind: 'stall' };

export type ProviderFixture = {
  /** The absolute URL a Worker's AI endpoint setting points at. */
  readonly endpoint: string;
  readonly providerRequests: number;
  /** Trace-propagation headers received with requests carrying this packet's evidence. */
  traceHeadersFor(packageName: string): readonly { readonly traceparent?: string; readonly b3?: string }[];
  /** Requests carrying this packet's evidence, so one case's count cannot be polluted by another case's straggler. */
  requestsFor(packageName: string): number;
  setMode(mode: ProviderMode): void;
  /**
   * Answers every held request with the response the current mode describes, so a case can park a generation and
   * then decide whether it comes back valid, invalid, or failed.
   */
  releaseStalls(): void;
  close(): Promise<void>;
};

/** The response a mode describes. `stall` never gets here: a held request is released into whatever mode is current. */
function respond(response: ServerResponse, mode: ProviderMode): void {
  if (mode.kind === 'http-error') {
    response.writeHead(503, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'fixture provider unavailable' }));

    return;
  }

  const bullets = mode.kind === 'invalid' ? [] : validBullets;

  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(
    JSON.stringify({
      id: 'chatcmpl-fixture',
      object: 'chat.completion',
      created: 1_700_000_000,
      model: MODEL,
      choices: [
        { index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ bullets }) } },
      ],
    }),
  );
}

/**
 * The one provider every runtime in this module instance is wired to. Started once per suite, before any runtime,
 * because `startRuntime` points the three AI settings at it.
 */
let provider: ProviderFixture | undefined;

export function providerFixture(): ProviderFixture {
  if (provider === undefined) throw new Error('Start the provider fixture before starting a runtime');

  return provider;
}

/**
 * `port: 0` (the default) binds an ephemeral port, which is what a suite wants; the local launcher smoke passes the
 * fixed port its `workers/briefing/.dev.vars` endpoint names.
 */
export async function startProviderFixture(options: { readonly port?: number } = {}): Promise<ProviderFixture> {
  const requests: { readonly body: string; readonly traceparent?: string; readonly b3?: string }[] = [];
  const stalled: ServerResponse[] = [];
  let mode: ProviderMode = { kind: 'valid' };

  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    void (async () => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      await once(request, 'end');
      requests.push({
        body: Buffer.concat(chunks).toString('utf8'),
        ...(isScalarString(request.headers.traceparent) ? { traceparent: request.headers.traceparent } : {}),
        ...(isScalarString(request.headers.b3) ? { b3: request.headers.b3 } : {}),
      });

      if (mode.kind === 'stall') {
        stalled.push(response);

        return;
      }

      respond(response, mode);
    })();
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, '127.0.0.1', resolve);
  });
  const address = server.address();

  if (address === null || isScalarString(address)) throw new Error('Expected the fixture provider to bind a TCP port');
  const { port } = address;

  provider = {
    endpoint: `http://127.0.0.1:${port}${PROVIDER_PATH}`,
    get providerRequests(): number {
      return requests.length;
    },
    requestsFor(packageName: string): number {
      // The evidence travels inside the prompt, so its JSON is escaped: match the bare identity instead.
      return requests.filter(({ body }) => body.includes(packageName)).length;
    },
    traceHeadersFor(packageName: string): readonly { readonly traceparent?: string; readonly b3?: string }[] {
      return requests
        .filter(({ body }) => body.includes(packageName))
        .map(({ traceparent, b3 }) => ({
          ...(traceparent === undefined ? {} : { traceparent }),
          ...(b3 === undefined ? {} : { b3 }),
        }));
    },
    setMode(next: ProviderMode): void {
      mode = next;
    },
    releaseStalls(): void {
      for (const response of stalled.splice(0)) {
        try {
          respond(response, mode);
        } catch {
          // The crashed runtime already closed the socket.
        }
      }
    },
    close: () =>
      new Promise<void>((resolve) => {
        // Workerd keeps connections alive, and `close()` alone would wait for them forever.
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };

  return provider;
}
