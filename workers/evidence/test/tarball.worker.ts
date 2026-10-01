import { Buffer } from 'node:buffer';
import { gzipSync } from 'node:zlib';

import { Effect } from 'effect';

import { inspectTarball, type TarParser } from '../../../server/utils/packageTarballStreaming';

function archiveFor(mode: string): Buffer | undefined {
  if (mode === 'valid') return gzipSync(Buffer.alloc(1024));
  if (mode === 'malformed') return gzipSync(Buffer.from('not a tar archive'));
  if (mode === 'oversized') return gzipSync(Buffer.alloc(32 * 1024 * 1024 + 1));
  return undefined;
}

async function countEntries(parser: TarParser): Promise<number> {
  let entries = 0;
  for await (const entry of parser) {
    for await (const chunk of entry) void chunk;
    entries++;
  }
  return entries;
}

export default {
  async fetch(request: Request): Promise<Response> {
    const body = archiveFor(new URL(request.url).pathname.slice(1));
    if (body === undefined) return Response.json({ error: 'Unknown tarball fixture' }, { status: 404 });
    try {
      const entries = await Effect.runPromise(inspectTarball(body, countEntries));
      return Response.json({ available: true, entries });
    } catch {
      return Response.json({ available: false }, { status: 422 });
    }
  },
};
