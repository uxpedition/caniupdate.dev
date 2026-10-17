export const PRIVATE_CI_KEYS = [
  'CLOUDFLARE_API_TOKEN',
  'CF_ACCESS_CLIENT_ID',
  'CF_ACCESS_CLIENT_SECRET',
  'AI_BRIEFING_ENDPOINT',
  'AI_BRIEFING_API_KEY',
  'AI_BRIEFING_MODEL',
  'PUBLIC_RATE_LIMIT',
  'BRIEFING_GENERATION_RATE_LIMIT',
  'NUXT_OTEL_ENDPOINT',
  'NUXT_OTEL_HEADERS',
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'OTEL_EXPORTER_OTLP_HEADERS',
  'GITHUB_TOKEN',
  'NUXT_PUBLIC_SITE_URL',
  'NUXT_PUBLIC_TELEMETRY_ENABLED',
  'NUXT_PUBLIC_RELEASE_VERSION',
  'BRIEFING_PUBLIC_URL',
  'GITLAB_RELEASE_TAG_API_TOKEN',
  'GITLAB_RELEASE_TAG_SSH_KEY',
  'GITLAB_RELEASE_TAG_DEPLOY_KEY_ID',
] as const;

type PrivateCiKey = (typeof PRIVATE_CI_KEYS)[number];

const ENVIRONMENT_BY_PRIVATE_KEY: Readonly<Record<PrivateCiKey, readonly string[]>> = {
  CLOUDFLARE_API_TOKEN: ['stage', 'production'],
  CF_ACCESS_CLIENT_ID: ['stage'],
  CF_ACCESS_CLIENT_SECRET: ['stage'],
  AI_BRIEFING_ENDPOINT: ['stage', 'production'],
  AI_BRIEFING_API_KEY: ['stage', 'production'],
  AI_BRIEFING_MODEL: ['stage', 'production'],
  PUBLIC_RATE_LIMIT: ['stage', 'production'],
  BRIEFING_GENERATION_RATE_LIMIT: ['stage', 'production'],
  NUXT_OTEL_ENDPOINT: ['stage', 'production'],
  NUXT_OTEL_HEADERS: ['stage', 'production'],
  OTEL_EXPORTER_OTLP_ENDPOINT: ['stage', 'production'],
  OTEL_EXPORTER_OTLP_HEADERS: ['stage', 'production'],
  GITHUB_TOKEN: ['stage', 'production'],
  NUXT_PUBLIC_SITE_URL: ['stage', 'production'],
  NUXT_PUBLIC_TELEMETRY_ENABLED: ['stage', 'production'],
  NUXT_PUBLIC_RELEASE_VERSION: [],
  BRIEFING_PUBLIC_URL: ['stage', 'production'],
  GITLAB_RELEASE_TAG_API_TOKEN: ['release-tag'],
  GITLAB_RELEASE_TAG_SSH_KEY: ['release-tag'],
  GITLAB_RELEASE_TAG_DEPLOY_KEY_ID: ['release-tag'],
};

export function hasCredentialScopeViolation(environment: Readonly<Record<string, string | undefined>>): boolean {
  const environmentName = environment['CI_ENVIRONMENT_NAME'] ?? '';

  for (const key of PRIVATE_CI_KEYS) {
    const value = environment[key];

    if (value !== undefined && value !== '' && !ENVIRONMENT_BY_PRIVATE_KEY[key].includes(environmentName)) {
      return true;
    }
  }

  return false;
}
