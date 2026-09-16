import { createError, defineEventHandler } from 'h3';
import { $fetch } from 'ofetch';

const NPM_LATEST_URL = 'https://registry.npmjs.org/nuxt/latest';

type NuxtLatestPackage = {
  name: string;
  version: string;
};

function parseNuxtLatestPackage(value: unknown): NuxtLatestPackage | undefined {
  if (typeof value !== 'object' || value === null || !('name' in value) || !('version' in value)) {
    return undefined;
  }

  const { name, version } = value;
  if (typeof name !== 'string' || typeof version !== 'string') {
    return undefined;
  }

  return { name, version };
}

export default defineEventHandler(async () => {
  let response: unknown;

  try {
    response = await $fetch<unknown>(NPM_LATEST_URL, { retry: false });
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : 'The upstream request failed.';

    throw createError({
      statusCode: 502,
      statusMessage: 'Unable to fetch the latest Nuxt package',
      message: `The npm registry request failed: ${reason}`,
    });
  }

  const packageInfo = parseNuxtLatestPackage(response);
  if (packageInfo === undefined) {
    throw createError({
      statusCode: 502,
      statusMessage: 'Invalid response from the npm registry',
      message: 'The npm registry did not return a valid Nuxt package response.',
    });
  }

  return packageInfo;
});
