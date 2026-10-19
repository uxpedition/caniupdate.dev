import { execFileSync } from 'node:child_process';
import { constants } from 'node:fs';
import { chmod, copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { Effect } from 'effect';

import { PRIVATE_CI_KEYS } from '../deploy/configurationKeys.ts';
import { ReleaseAutomationFailure } from './version.ts';

const GITLAB_SSH_REMOTE = 'git@gitlab.com:uxpedition/caniupdate.dev.git';
const GITLAB_ED25519_FINGERPRINT = 'SHA256:eUXGGm1YGsMAS7vkcx6JOJdOGHPem5gQp4taiCfCLB8';
const SSH_SETUP_FAILURE = 'GitLab SSH trust setup failed; provider output was suppressed';

const SENSITIVE_GITLAB_CI_KEYS = [
  'CI_JOB_TOKEN',
  'CI_DEPLOY_PASSWORD',
  'CI_REGISTRY_PASSWORD',
  'CI_REPOSITORY_URL',
] as const;

type TrustedGitLabSsh = {
  readonly command: string;
};

function isolatedToolEnvironment(overrides: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const environment = { ...overrides };

  for (const key of PRIVATE_CI_KEYS) delete environment[key];
  for (const key of SENSITIVE_GITLAB_CI_KEYS) delete environment[key];

  return environment;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function copyPrivateKeyForSsh(
  privateKeyFile: string,
  directory: string,
): Effect.Effect<string, ReleaseAutomationFailure> {
  const sourcePath = resolve(privateKeyFile);
  const destinationPath = resolve(directory, 'release-key');

  return Effect.gen(function* () {
    yield* Effect.tryPromise({
      try: () => copyFile(sourcePath, destinationPath, constants.COPYFILE_EXCL),
      catch: () => new ReleaseAutomationFailure(SSH_SETUP_FAILURE),
    });
    yield* Effect.tryPromise({
      try: () => chmod(destinationPath, 0o600),
      catch: () => new ReleaseAutomationFailure(SSH_SETUP_FAILURE),
    });

    return destinationPath;
  });
}

function runGit(
  args: readonly string[],
  environment = isolatedToolEnvironment(),
): Effect.Effect<string, ReleaseAutomationFailure> {
  return Effect.try({
    try: () =>
      execFileSync('git', [...args], {
        encoding: 'utf8',
        env: environment,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim(),
    catch: () => new ReleaseAutomationFailure('Git release-tag operation failed; provider output was suppressed'),
  });
}

function readVerifiedHostKeys(directory: string): Effect.Effect<readonly string[], ReleaseAutomationFailure> {
  return Effect.gen(function* () {
    const keyScan = yield* Effect.try({
      try: () =>
        execFileSync('ssh-keyscan', ['-T', '10', '-t', 'ed25519', 'gitlab.com'], {
          encoding: 'utf8',
          env: isolatedToolEnvironment(),
          stdio: ['ignore', 'pipe', 'ignore'],
        }),
      catch: () => new ReleaseAutomationFailure(SSH_SETUP_FAILURE),
    });
    const keyLines = keyScan.split('\n').filter((line) => line.length > 0 && !line.startsWith('#'));

    if (keyLines.length === 0) {
      return yield* Effect.fail(new ReleaseAutomationFailure('GitLab SSH host key could not be verified'));
    }

    const knownHosts: string[] = [];

    for (const line of keyLines) {
      const [host, type, key] = line.split(/\s+/);

      if (host === undefined || type !== 'ssh-ed25519' || key === undefined) {
        return yield* Effect.fail(new ReleaseAutomationFailure('GitLab SSH host-key response is invalid'));
      }

      const publicKeyPath = resolve(directory, `host-${knownHosts.length}.pub`);
      yield* Effect.tryPromise({
        try: () => writeFile(publicKeyPath, `${type} ${key}\n`, { mode: 0o600 }),
        catch: () => new ReleaseAutomationFailure(SSH_SETUP_FAILURE),
      });
      const fingerprint = yield* Effect.try({
        try: () =>
          execFileSync('ssh-keygen', ['-lf', publicKeyPath, '-E', 'sha256'], {
            encoding: 'utf8',
            env: isolatedToolEnvironment(),
            stdio: ['ignore', 'pipe', 'ignore'],
          }),
        catch: () => new ReleaseAutomationFailure(SSH_SETUP_FAILURE),
      });

      if (!fingerprint.includes(GITLAB_ED25519_FINGERPRINT)) {
        return yield* Effect.fail(
          new ReleaseAutomationFailure('GitLab SSH host fingerprint does not match the pinned official key'),
        );
      }

      knownHosts.push(line);
    }

    return knownHosts;
  });
}

function configureTrustedGitLabSsh(
  privateKeyFile: string,
  directory: string,
): Effect.Effect<TrustedGitLabSsh, ReleaseAutomationFailure> {
  return Effect.gen(function* () {
    const sshKeyPath = yield* copyPrivateKeyForSsh(privateKeyFile, directory);
    const knownHosts = yield* readVerifiedHostKeys(directory);
    const knownHostsPath = resolve(directory, 'known_hosts');

    yield* Effect.tryPromise({
      try: () => writeFile(knownHostsPath, `${knownHosts.join('\n')}\n`, { mode: 0o600 }),
      catch: () => new ReleaseAutomationFailure(SSH_SETUP_FAILURE),
    });

    const command = [
      'ssh',
      '-i',
      shellQuote(sshKeyPath),
      '-o',
      `UserKnownHostsFile=${shellQuote(knownHostsPath)}`,
      '-o',
      'GlobalKnownHostsFile=/dev/null',
      '-o',
      'StrictHostKeyChecking=yes',
      '-o',
      'IdentitiesOnly=yes',
      '-o',
      'IdentityAgent=none',
      '-o',
      'BatchMode=yes',
      '-o',
      'PreferredAuthentications=publickey',
      '-o',
      'PasswordAuthentication=no',
      '-o',
      'ConnectTimeout=15',
    ].join(' ');

    return { command };
  });
}

export function pushAnnotatedReleaseTag(
  version: string,
  commitSha: string,
  message: string,
  privateKeyFile: string,
): Effect.Effect<void, ReleaseAutomationFailure> {
  const tagName = `v${version}`;

  return Effect.gen(function* () {
    if ((yield* runGit(['tag', '--list', tagName])) !== '') {
      return yield* Effect.fail(
        new ReleaseAutomationFailure(`Local release tag ${tagName} already exists unexpectedly`),
      );
    }

    const keyPath = resolve(privateKeyFile);

    if (keyPath === '/' || keyPath.trim() === '') {
      return yield* Effect.fail(new ReleaseAutomationFailure('Release deploy-key file path is invalid'));
    }

    // Bracket the SSH workspace and delete a locally created tag after a failed publication.
    // Effect API: https://effect.website/docs/v4/api/effect/Effect
    yield* Effect.acquireUseRelease(
      Effect.tryPromise({
        try: () => mkdtemp(resolve(tmpdir(), 'can-i-update-release-ssh-')),
        catch: () => new ReleaseAutomationFailure(SSH_SETUP_FAILURE),
      }),
      (directory) =>
        configureTrustedGitLabSsh(privateKeyFile, directory).pipe(
          Effect.flatMap((trustedSsh) => {
            let tagCreated = false;

            const publish = Effect.gen(function* () {
              yield* runGit(
                ['tag', '-a', tagName, commitSha, '-m', message],
                isolatedToolEnvironment({
                  ...process.env,
                  GIT_COMMITTER_NAME: 'Can I update release automation',
                  GIT_COMMITTER_EMAIL: 'release-automation@can-i-update.invalid',
                }),
              );
              yield* Effect.sync(() => {
                tagCreated = true;
              });
              yield* runGit(
                ['push', GITLAB_SSH_REMOTE, `refs/tags/${tagName}`],
                isolatedToolEnvironment({
                  ...process.env,
                  GIT_SSH_COMMAND: trustedSsh.command,
                  GIT_TERMINAL_PROMPT: '0',
                }),
              );
            });

            return publish.pipe(
              Effect.catch(() =>
                Effect.gen(function* () {
                  if (tagCreated) yield* runGit(['tag', '-d', tagName]);

                  return yield* Effect.fail(
                    new ReleaseAutomationFailure(
                      'Protected release tag push failed; remote state must be inspected before retrying',
                    ),
                  );
                }),
              ),
            );
          }),
        ),
      (directory) =>
        Effect.tryPromise({
          try: () => rm(directory, { recursive: true, force: true }),
          catch: () => new ReleaseAutomationFailure('Temporary GitLab SSH files could not be removed'),
        }),
    );
  });
}
