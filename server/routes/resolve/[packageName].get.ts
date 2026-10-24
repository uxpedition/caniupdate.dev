import { Schema } from 'effect';
import { createError, defineEventHandler, setResponseHeader } from 'h3';
import { minSatisfying } from 'semver';

import { ParsedPackageMetadataSchema } from '#shared/comparison/package/package.defs';

import { readComparisonRequest } from '../../api/package/[packageName]/compare/_internals/request';

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store');
  setResponseHeader(event, 'Cloudflare-CDN-Cache-Control', 'no-store');
  const { packageName, from, to } = await readComparisonRequest(event);
  let metadata;

  try {
    const response = await event.$fetch(`/api/package/${encodeURIComponent(packageName)}`, { retry: 0 });
    metadata = Schema.decodeUnknownSync(ParsedPackageMetadataSchema)(response);

    if (metadata.name !== packageName) throw new Error('Metadata identity mismatch');
  } catch {
    throw createError({
      statusCode: 503,
      statusMessage: 'Package metadata temporarily unavailable. Reload this page to try again later.',
    });
  }

  const fromVersion = minSatisfying(metadata.versions, from);
  const toVersion = minSatisfying(metadata.versions, to);

  if (fromVersion === null || toVersion === null) {
    throw createError({
      statusCode: 404,
      statusMessage: 'No published release matches one or both dependency ranges. Choose different ranges.',
    });
  }

  return new Response(null, {
    status: 302,
    headers: {
      Location: `/${encodeURIComponent(packageName)}/${fromVersion}...${toVersion}`,
      'Cache-Control': 'no-store',
      'Cloudflare-CDN-Cache-Control': 'no-store',
    },
  });
});
