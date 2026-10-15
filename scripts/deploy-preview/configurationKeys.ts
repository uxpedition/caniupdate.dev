export const STAGE_ORIGIN = 'https://stage.caniupdate.dev';

export const STAGE_SOCKET_ORIGIN = 'wss://stage-briefing.caniupdate.dev';

export const PRIVATE_CI_KEYS = [
  'CLOUDFLARE_API_TOKEN',
  'CF_ACCESS_CLIENT_ID',
  'CF_ACCESS_CLIENT_SECRET',
  'AI_BRIEFING_ENDPOINT',
  'AI_BRIEFING_API_KEY',
  'AI_BRIEFING_MODEL',
  // Runtime-only Nuxt names are not GitLab inputs, but must also stay out of build/validation processes.
  'NUXT_OTEL_ENDPOINT',
  'NUXT_OTEL_HEADERS',
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'OTEL_EXPORTER_OTLP_HEADERS',
  'GITHUB_TOKEN',
] as const;

export function assertCredentialIsolation(environment: NodeJS.ProcessEnv): void {
  if (environment.CI_ENVIRONMENT_NAME === 'stage') return;

  if (PRIVATE_CI_KEYS.some((key) => environment[key] !== undefined && environment[key] !== '')) {
    throw new Error(
      'Deployment/private runtime variables must be scoped exactly to stage, never to build or validation jobs',
    );
  }

  if (environment.CI_JOB_NAME === 'build:stage' && environment.NUXT_PUBLIC_SITE_URL !== STAGE_ORIGIN) {
    throw new Error('stage-build requires the GitLab NUXT_PUBLIC_SITE_URL stage origin');
  }
}
