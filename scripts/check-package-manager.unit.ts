import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const guardScript = fileURLToPath(new URL('./check-package-manager.mjs', import.meta.url));

function runGuard(userAgent?: string) {
  const env = { ...process.env };
  if (userAgent === undefined) delete env.npm_config_user_agent;
  else env.npm_config_user_agent = userAgent;

  return spawnSync(process.execPath, [guardScript], { encoding: 'utf8', env });
}

describe('package manager install guard', () => {
  it('rejects pnpm and tells the user to install with Nub', () => {
    const result = runGuard('pnpm/12.6.0 npm/? node/? linux x64');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('This repository uses Nub');
    expect(result.stderr).toContain('nub ci');
  });

  it('rejects an unidentified package manager', () => {
    const result = runGuard();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('This repository uses Nub');
  });

  it('allows Nub', () => {
    const result = runGuard('nub/0.8.3 node/v26.8.1 linux x64');

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });
});
