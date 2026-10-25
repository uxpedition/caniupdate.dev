import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';

import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { pushAnnotatedReleaseTag } from './gitlabTagPush.ts';
import { ReleaseAutomationFailure } from './version.ts';

const fixture = vi.hoisted(() => {
  const commands: string[][] = [];

  return { commands, publicKeyPath: '', fingerprintMatches: true, pushFails: false };
});

vi.mock('node:child_process', () => ({
  execFileSync(command: string, args: readonly string[]) {
    fixture.commands.push([command, ...args]);

    if (command === 'ssh-keyscan') return 'gitlab.com ssh-ed25519 synthetic-fixture-key\n';

    if (command === 'ssh-keygen') {
      fixture.publicKeyPath = args[1] ?? '';

      return fixture.fingerprintMatches
        ? '256 SHA256:eUXGGm1YGsMAS7vkcx6JOJdOGHPem5gQp4taiCfCLB8 fixture (ED25519)'
        : '256 SHA256:untrusted-fixture fixture (ED25519)';
    }

    if (command === 'git' && args[0] === 'push' && fixture.pushFails) {
      throw new Error('synthetic provider output must remain private');
    }

    return '';
  },
}));

beforeEach(() => {
  fixture.commands = [];
  fixture.publicKeyPath = '';
  fixture.fingerprintMatches = true;
  fixture.pushFails = false;
});

describe('release publication with isolated subprocess fixtures', () => {
  it.each(['success', 'push-failure', 'untrusted-host'])('cleans SSH files after %s', async (scenario) => {
    const directory = await mkdtemp(resolve(tmpdir(), 'can-i-update-publication-fixture-'));
    const privateKeyPath = resolve(directory, 'synthetic-key');
    fixture.pushFails = scenario === 'push-failure';
    fixture.fingerprintMatches = scenario !== 'untrusted-host';

    try {
      await writeFile(privateKeyPath, 'synthetic fixture; not a credential\n', { mode: 0o600 });

      const publication = Effect.runPromise(
        pushAnnotatedReleaseTag('1.2.3', 'a'.repeat(40), 'fixture annotation', privateKeyPath),
      );

      if (scenario === 'success') {
        await expect(publication).resolves.toBeUndefined();
      } else {
        await expect(publication).rejects.toBeInstanceOf(ReleaseAutomationFailure);
        await expect(publication).rejects.toThrow(
          scenario === 'untrusted-host' ? 'pinned official key' : 'remote state must be inspected',
        );
      }

      expect(fixture.publicKeyPath).not.toBe('');
      await expect(access(dirname(fixture.publicKeyPath))).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(access(privateKeyPath)).resolves.toBeUndefined();

      const gitCommands = fixture.commands.filter(([command]) => command === 'git');

      if (scenario === 'untrusted-host') {
        expect(gitCommands).toEqual([['git', 'tag', '--list', 'v1.2.3']]);
      } else {
        expect(gitCommands.slice(1, 3)).toEqual([
          ['git', 'tag', '-a', 'v1.2.3', 'a'.repeat(40), '-m', 'fixture annotation'],
          ['git', 'push', 'git@gitlab.com:uxpedition-oss/caniupdate.dev.git', 'refs/tags/v1.2.3'],
        ]);
        expect(gitCommands.slice(3)).toEqual(scenario === 'push-failure' ? [['git', 'tag', '-d', 'v1.2.3']] : []);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
