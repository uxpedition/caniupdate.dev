import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { Effect, Schema } from 'effect';

import {
  decodeReleaseTagReceipt,
  isStableReleaseVersion,
  type ReleaseTagReceipt,
} from '../../shared/site/releaseIdentity.ts';
import { BuildArtifactIdentitySchema } from '../deploy/buildArtifact.ts';
import { GitLabApiClient, type GitLabClient } from './gitlabApi.ts';
import { pushAnnotatedReleaseTag } from './gitlabTagPush.ts';
import { releaseTagMessage } from './metadata.ts';
import {
  assertCurrentProtectedMain,
  assertLatestReleaseVersion,
  assertProtectedTagAccess,
  assertVerifiedProtectedMainPipeline,
} from './tagVerification.ts';
import { ReleaseAutomationFailure } from './version.ts';

const SHA = /^[0-9a-f]{40}$/;

const POSITIVE_ID = /^[1-9][0-9]*$/;

export type ReleaseTagInput = {
  readonly version: string;
  readonly commitSha: string;
  readonly pipelineId: string;
  readonly jobId: string;
  readonly buildIdentityContents: string;
  readonly deployKeyId: string;
  readonly privateKeyFile: string;
};

export type ReleaseTagResult = ReleaseTagReceipt & { readonly reused: boolean };

export type ReleaseTagPublisher = (
  version: string,
  commitSha: string,
  message: string,
  privateKeyFile: string,
) => Effect.Effect<void, ReleaseAutomationFailure>;

type PreparedReleaseTag = {
  readonly receipt: ReleaseTagReceipt;
  readonly message: string;
  readonly reused: boolean;
};

export function assertReleaseTagContext(environment: NodeJS.ProcessEnv): Effect.Effect<void, ReleaseAutomationFailure> {
  return Effect.gen(function* () {
    const expected = {
      CI_SERVER_HOST: 'gitlab.com',
      CI_PROJECT_ID: '86537464',
      CI_PROJECT_PATH: 'uxpedition-oss/caniupdate.dev',
      CI_PIPELINE_SOURCE: 'push',
      CI_COMMIT_BRANCH: 'main',
      CI_COMMIT_REF_PROTECTED: 'true',
      CI_JOB_MANUAL: 'true',
      CI_JOB_NAME: 'release:tag',
      CI_ENVIRONMENT_NAME: 'release-tag',
    };

    for (const [name, value] of Object.entries(expected)) {
      if (environment[name] !== value) {
        return yield* Effect.fail(
          new ReleaseAutomationFailure('Release tagging is accepted only from the manual protected-main job'),
        );
      }
    }

    if (
      !SHA.test(environment.CI_COMMIT_SHA ?? '') ||
      !POSITIVE_ID.test(environment.CI_PIPELINE_ID ?? '') ||
      !POSITIVE_ID.test(environment.CI_JOB_ID ?? '') ||
      !isStableReleaseVersion(environment.RELEASE_VERSION)
    ) {
      return yield* Effect.fail(new ReleaseAutomationFailure('Release pipeline or version input is invalid'));
    }
  });
}

function decodeBuildArtifact(
  contents: string,
): Effect.Effect<typeof BuildArtifactIdentitySchema.Type, ReleaseAutomationFailure> {
  return Schema.decodeUnknownEffect(Schema.fromJsonString(BuildArtifactIdentitySchema), {
    errors: 'all',
    onExcessProperty: 'ignore',
  })(contents).pipe(Effect.mapError(() => new ReleaseAutomationFailure('Build identity artifact is invalid')));
}

function releaseDeployKeyId(value: string): Effect.Effect<number, ReleaseAutomationFailure> {
  const deployKeyId = Number(value);

  if (!Number.isSafeInteger(deployKeyId) || deployKeyId < 1) {
    return Effect.fail(new ReleaseAutomationFailure('Configured release deploy-key ID is invalid'));
  }

  return Effect.succeed(deployKeyId);
}

function prepareReleaseTag(
  input: ReleaseTagInput,
  api: GitLabClient,
): Effect.Effect<PreparedReleaseTag, ReleaseAutomationFailure> {
  return Effect.gen(function* () {
    if (
      !isStableReleaseVersion(input.version) ||
      !SHA.test(input.commitSha) ||
      !POSITIVE_ID.test(input.pipelineId) ||
      !POSITIVE_ID.test(input.jobId)
    ) {
      return yield* Effect.fail(
        new ReleaseAutomationFailure('Release pipeline identity or stable version input is invalid'),
      );
    }

    const buildIdentity = yield* decodeBuildArtifact(input.buildIdentityContents);

    if (buildIdentity.commitSha !== input.commitSha || buildIdentity.pipelineId !== input.pipelineId) {
      return yield* Effect.fail(
        new ReleaseAutomationFailure('Build artifact does not match the verified release pipeline and commit'),
      );
    }

    const receipt = yield* Effect.try({
      try: () =>
        decodeReleaseTagReceipt({
          version: input.version,
          tag: `v${input.version}`,
          commitSha: input.commitSha,
          pipelineId: input.pipelineId,
        }),
      catch: () => new ReleaseAutomationFailure('Release tag identity is invalid'),
    });

    yield* assertVerifiedProtectedMainPipeline(api, input.pipelineId, input.commitSha, input.jobId);
    yield* assertProtectedTagAccess(api, receipt.tag, yield* releaseDeployKeyId(input.deployKeyId));

    return {
      receipt,
      message: releaseTagMessage(receipt),
      reused: yield* assertLatestReleaseVersion(api, receipt),
    };
  });
}

export function createReleaseTag(
  input: ReleaseTagInput,
  api: GitLabClient,
  writeReceipt: (contents: string) => Effect.Effect<void, ReleaseAutomationFailure>,
  publishTag: ReleaseTagPublisher = pushAnnotatedReleaseTag,
): Effect.Effect<ReleaseTagResult, ReleaseAutomationFailure> {
  return Effect.gen(function* () {
    const prepared = yield* prepareReleaseTag(input, api);
    const { receipt } = prepared;

    if (prepared.reused) {
      yield* writeReceipt(`${JSON.stringify(receipt, null, 2)}\n`);

      return { ...receipt, reused: true };
    }

    if (input.privateKeyFile.trim() === '') {
      return yield* Effect.fail(new ReleaseAutomationFailure('Release deploy-key private file is missing'));
    }

    yield* assertCurrentProtectedMain(api, input.commitSha);
    yield* publishTag(receipt.version, receipt.commitSha, prepared.message, input.privateKeyFile);

    if (!(yield* assertLatestReleaseVersion(api, receipt))) {
      return yield* Effect.fail(
        new ReleaseAutomationFailure('GitLab did not confirm the immutable protected release tag'),
      );
    }

    yield* writeReceipt(`${JSON.stringify(receipt, null, 2)}\n`);

    return { ...receipt, reused: false };
  });
}

export function loadReleaseTagInput(
  environment: NodeJS.ProcessEnv,
): Effect.Effect<ReleaseTagInput, ReleaseAutomationFailure> {
  return Effect.gen(function* () {
    const buildIdentityContents = yield* Effect.tryPromise({
      try: () => readFile(resolve('.output/build-identity.json'), 'utf8'),
      catch: () => new ReleaseAutomationFailure('Build identity artifact could not be read'),
    });

    const version = environment['RELEASE_VERSION'];
    const commitSha = environment['CI_COMMIT_SHA'];
    const pipelineId = environment['CI_PIPELINE_ID'];
    const jobId = environment['CI_JOB_ID'];
    const deployKeyId = environment['GITLAB_RELEASE_TAG_DEPLOY_KEY_ID'];
    const privateKeyFile = environment['GITLAB_RELEASE_TAG_SSH_KEY'];

    if (
      version === undefined ||
      commitSha === undefined ||
      pipelineId === undefined ||
      jobId === undefined ||
      deployKeyId === undefined ||
      privateKeyFile === undefined
    ) {
      return yield* Effect.fail(new ReleaseAutomationFailure('Required release-tag CI context is missing'));
    }

    return { version, commitSha, pipelineId, jobId, buildIdentityContents, deployKeyId, privateKeyFile };
  });
}

export function createReleaseTagApiFromEnvironment(
  environment: NodeJS.ProcessEnv,
): Effect.Effect<GitLabApiClient, ReleaseAutomationFailure> {
  const token = environment['GITLAB_RELEASE_TAG_API_TOKEN'];

  if (token === undefined || token.trim() === '') {
    return Effect.fail(new ReleaseAutomationFailure('GitLab release-tag read API credential is missing'));
  }

  return Effect.succeed(new GitLabApiClient(token));
}
