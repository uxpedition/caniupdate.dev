import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const checkScript = fileURLToPath(new URL('./check-site-url.ts', import.meta.url));

/** A private directory per case, so a `.env` beside the repository cannot decide the outcome. */
const workspace = (envFile?: string): string => {
  const directory = mkdtempSync(join(tmpdir(), 'check-site-url-'));

  if (envFile !== undefined) {
    writeFileSync(join(directory, '.env'), envFile);
  }

  return directory;
};

/**
 * The check runs exactly as the build script runs it: the real file, the real process environment. The variable is
 * always cleared first so the developer's own shell cannot make a case pass.
 */
const runCheck = (options: { readonly cwd: string; readonly siteUrl?: string }) => {
  const env = { ...process.env };
  delete env.NUXT_PUBLIC_SITE_URL;

  if (options.siteUrl !== undefined) {
    env.NUXT_PUBLIC_SITE_URL = options.siteUrl;
  }

  return spawnSync(process.execPath, [checkScript], { cwd: options.cwd, encoding: 'utf8', env });
};

describe('site URL release check', () => {
  it('refuses a build with no configured origin', () => {
    const result = runCheck({ cwd: workspace() });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('NUXT_PUBLIC_SITE_URL is not set');
  });

  it('refuses a configured value that is not an origin', () => {
    const result = runCheck({ cwd: workspace(), siteUrl: 'caniupdate.dev' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('absolute URL');
  });

  it('accepts a valid origin from the process environment', () => {
    const result = runCheck({ cwd: workspace(), siteUrl: 'https://caniupdate.dev' });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });

  it('reads a local .env the way Nuxt does, with the process environment taking precedence', () => {
    const fromFile = runCheck({ cwd: workspace('NUXT_PUBLIC_SITE_URL=https://preview.example\n') });

    expect(fromFile.status).toBe(0);

    const overridden = runCheck({
      cwd: workspace('NUXT_PUBLIC_SITE_URL=https://preview.example\n'),
      siteUrl: 'broken',
    });

    expect(overridden.status).toBe(1);
  });
});
