// A release build must name the origin it publishes: canonical, social, and later sitemap URLs are built from
// `NUXT_PUBLIC_SITE_URL`, and a prerendered page bakes the value into its HTML — a missing origin cannot be repaired
// after the build. `.env` is read the way the Nuxt CLI reads it, with the process environment taking precedence.
import { parseSiteOrigin } from '../../shared/siteUrl.ts';

try {
  process.loadEnvFile('.env');
} catch {
  // No `.env` beside the build: the variable must then come from the process environment.
}

const parsed = parseSiteOrigin(process.env['NUXT_PUBLIC_SITE_URL']);

if (!parsed.ok) {
  process.stderr.write(
    `NUXT_PUBLIC_SITE_URL ${parsed.reason}. Set it to the public origin this build publishes, for example:\n` +
      '  NUXT_PUBLIC_SITE_URL=https://caniupdate.dev nub run build\n',
  );
  process.exitCode = 1;
}
