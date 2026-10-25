import { Effect, Schema } from 'effect';

import { type ReleaseTagReceipt, isStableReleaseVersion } from '../../shared/site/releaseIdentity.ts';
import { type GitLabClient } from './gitlabApi.ts';
import { releaseMetadataFromTagMessage } from './metadata.ts';
import { compareStableReleaseVersions, ReleaseAutomationFailure } from './version.ts';

const SHA = Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/));

const PositiveId = Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0));

const NullableNumber = Schema.Union([Schema.Number, Schema.Null]);

const NullableString = Schema.Union([Schema.String, Schema.Null]);

const BranchSchema = Schema.Struct({
  name: Schema.String,
  protected: Schema.Boolean,
  commit: Schema.Struct({ id: SHA }),
});

const PipelineSchema = Schema.Struct({
  id: PositiveId,
  status: Schema.String,
  source: Schema.String,
  ref: Schema.String,
  sha: SHA,
});

const ReleaseJobSchema = Schema.Struct({
  id: PositiveId,
  name: Schema.String,
  status: Schema.String,
  pipeline: Schema.Struct({ id: PositiveId }),
  user: Schema.Union([Schema.Struct({ id: PositiveId, username: Schema.String }), Schema.Null]),
});

const MemberSchema = Schema.Struct({ id: PositiveId, access_level: PositiveId });

const PipelineJobSchema = Schema.Struct({ name: Schema.String, status: Schema.String, allow_failure: Schema.Boolean });

const BridgeSchema = Schema.Struct({
  name: Schema.String,
  status: Schema.String,
  allow_failure: Schema.Boolean,
  downstream_pipeline: Schema.Union([Schema.Struct({ id: PositiveId }), Schema.Null]),
});

const DownstreamPipelineSchema = Schema.Struct({
  id: PositiveId,
  status: Schema.String,
  source: Schema.String,
  ref: Schema.String,
  sha: SHA,
});

const RepositoryTagSchema = Schema.Struct({ name: Schema.String, commit: Schema.Struct({ id: SHA }) });

const TagSchema = Schema.Struct({
  name: Schema.String,
  target: SHA,
  protected: Schema.Boolean,
  message: NullableString,
  commit: Schema.Struct({ id: SHA }),
});

const ProtectedTagAccessSchema = Schema.Struct({
  access_level: Schema.optionalKey(NullableNumber),
  user_id: Schema.optionalKey(NullableNumber),
  group_id: Schema.optionalKey(NullableNumber),
  deploy_key_id: Schema.optionalKey(NullableNumber),
});

const ProtectedTagSchema = Schema.Struct({
  name: Schema.String,
  create_access_levels: Schema.Array(ProtectedTagAccessSchema),
});

const DECODE_OPTIONS = { errors: 'all' as const, onExcessProperty: 'ignore' as const };

function decode<A>(
  schema: Schema.Codec<A>,
  value: Schema.Json,
  failure: string,
): Effect.Effect<A, ReleaseAutomationFailure> {
  return Schema.decodeUnknownEffect(
    schema,
    DECODE_OPTIONS,
  )(value).pipe(Effect.mapError(() => new ReleaseAutomationFailure(failure)));
}

export function assertCurrentProtectedMain(
  api: GitLabClient,
  commitSha: string,
): Effect.Effect<void, ReleaseAutomationFailure> {
  return Effect.gen(function* () {
    const branch = yield* decode(
      BranchSchema,
      yield* api.request('/repository/branches/main'),
      'GitLab main branch response is invalid',
    );

    if (branch.name !== 'main' || !branch.protected || branch.commit.id !== commitSha) {
      return yield* Effect.fail(
        new ReleaseAutomationFailure('Release candidate is not the current protected main commit'),
      );
    }
  });
}

function requireSuccessfulJobs(
  jobs: readonly (typeof PipelineJobSchema.Type)[],
  requiredNames: readonly string[],
  failure: string,
): Effect.Effect<void, ReleaseAutomationFailure> {
  return Effect.gen(function* () {
    for (const name of requiredNames) {
      const matching = jobs.filter((job) => job.name === name);

      if (matching.length !== 1 || matching[0]?.status !== 'success' || matching[0].allow_failure) {
        return yield* Effect.fail(new ReleaseAutomationFailure(failure));
      }
    }
  });
}

function assertMainPushPipeline(
  api: GitLabClient,
  pipelineId: number,
  commitSha: string,
): Effect.Effect<void, ReleaseAutomationFailure> {
  return Effect.gen(function* () {
    const pipeline = yield* decode(
      PipelineSchema,
      yield* api.request(`/pipelines/${pipelineId}`),
      'GitLab release pipeline response is invalid',
    );

    if (
      pipeline.id !== pipelineId ||
      pipeline.source !== 'push' ||
      pipeline.ref !== 'main' ||
      pipeline.sha !== commitSha
    ) {
      return yield* Effect.fail(
        new ReleaseAutomationFailure('Release candidate does not match a protected main push pipeline'),
      );
    }
  });
}

function assertMaintainerReleaseJob(
  api: GitLabClient,
  pipelineId: number,
  releaseJobId: number,
): Effect.Effect<void, ReleaseAutomationFailure> {
  return Effect.gen(function* () {
    const releaseJob = yield* decode(
      ReleaseJobSchema,
      yield* api.request(`/jobs/${releaseJobId}`),
      'GitLab release job response is invalid',
    );

    const actor = releaseJob.user;

    if (
      releaseJob.id !== releaseJobId ||
      releaseJob.name !== 'release:tag' ||
      releaseJob.status !== 'running' ||
      releaseJob.pipeline.id !== pipelineId ||
      actor === null
    ) {
      return yield* Effect.fail(
        new ReleaseAutomationFailure('Release must be started by a Maintainer or Owner from its verified pipeline'),
      );
    }

    const member = yield* decode(
      MemberSchema,
      yield* api.request(`/members/all/${actor.id}`),
      'GitLab release actor membership response is invalid',
    );

    if (member.id !== actor.id || member.access_level < 40) {
      return yield* Effect.fail(
        new ReleaseAutomationFailure('Only a Maintainer or Owner may create a production release tag'),
      );
    }
  });
}

function assertSuccessfulMainJobs(
  api: GitLabClient,
  pipelineId: number,
): Effect.Effect<void, ReleaseAutomationFailure> {
  return Effect.gen(function* () {
    const rawJobs = yield* api.listPages(`/pipelines/${pipelineId}/jobs?include_retried=false`);

    const parentJobs = yield* Effect.forEach(rawJobs, (value) =>
      decode(PipelineJobSchema, value, 'GitLab main pipeline job response is invalid'),
    );

    yield* requireSuccessfulJobs(
      parentJobs,
      ['quality', 'unit-tests', 'build-smoke', 'smoke:built'],
      'Required protected-main validation or build-smoke job did not succeed',
    );
  });
}

function stagePipelineIdFromBridge(
  api: GitLabClient,
  pipelineId: number,
): Effect.Effect<number, ReleaseAutomationFailure> {
  return Effect.gen(function* () {
    const rawBridges = yield* api.listPages(`/pipelines/${pipelineId}/bridges`);

    const bridges = yield* Effect.forEach(rawBridges, (value) =>
      decode(BridgeSchema, value, 'GitLab stage delivery bridge response is invalid'),
    );

    const stageBridges = bridges.filter((bridge) => bridge.name === 'stage:delivery');
    const [stageBridge] = stageBridges;

    if (
      stageBridges.length !== 1 ||
      stageBridge === undefined ||
      stageBridge.status !== 'success' ||
      stageBridge.allow_failure ||
      stageBridge.downstream_pipeline === null
    ) {
      return yield* Effect.fail(
        new ReleaseAutomationFailure('Protected-main stage delivery and both browser verifications must succeed'),
      );
    }

    return stageBridge.downstream_pipeline.id;
  });
}

function assertSuccessfulStagePipeline(
  api: GitLabClient,
  stagePipelineId: number,
  commitSha: string,
): Effect.Effect<void, ReleaseAutomationFailure> {
  return Effect.gen(function* () {
    const stagePipeline = yield* decode(
      DownstreamPipelineSchema,
      yield* api.request(`/pipelines/${stagePipelineId}`),
      'GitLab stage pipeline response is invalid',
    );

    if (
      stagePipeline.id !== stagePipelineId ||
      stagePipeline.status !== 'success' ||
      stagePipeline.source !== 'parent_pipeline' ||
      stagePipeline.ref !== 'main' ||
      stagePipeline.sha !== commitSha
    ) {
      return yield* Effect.fail(
        new ReleaseAutomationFailure('Stage pipeline does not verify the exact protected-main release commit'),
      );
    }

    const rawJobs = yield* api.listPages(`/pipelines/${stagePipelineId}/jobs?include_retried=false`);

    const stageJobs = yield* Effect.forEach(rawJobs, (value) =>
      decode(PipelineJobSchema, value, 'GitLab stage job response is invalid'),
    );

    yield* requireSuccessfulJobs(
      stageJobs,
      ['deploy:stage', 'verify:stage: [chromium]', 'verify:stage: [firefox]'],
      'Stage deployment and Chromium/Firefox verification must all succeed',
    );
  });
}

export function assertVerifiedProtectedMainPipeline(
  api: GitLabClient,
  pipelineId: string,
  commitSha: string,
  releaseJobId: string,
): Effect.Effect<void, ReleaseAutomationFailure> {
  return Effect.gen(function* () {
    const pipelineIdNumber = Number(pipelineId);
    const releaseJobIdNumber = Number(releaseJobId);

    if (
      !Number.isSafeInteger(pipelineIdNumber) ||
      pipelineIdNumber < 1 ||
      !Number.isSafeInteger(releaseJobIdNumber) ||
      releaseJobIdNumber < 1
    ) {
      return yield* Effect.fail(new ReleaseAutomationFailure('Release pipeline identity is invalid'));
    }

    yield* assertCurrentProtectedMain(api, commitSha);
    yield* assertMainPushPipeline(api, pipelineIdNumber, commitSha);
    yield* assertMaintainerReleaseJob(api, pipelineIdNumber, releaseJobIdNumber);
    yield* assertSuccessfulMainJobs(api, pipelineIdNumber);

    const stagePipelineId = yield* stagePipelineIdFromBridge(api, pipelineIdNumber);
    yield* assertSuccessfulStagePipeline(api, stagePipelineId, commitSha);
  });
}

function latestStableReleaseVersion(
  tags: readonly Schema.Json[],
): Effect.Effect<string | undefined, ReleaseAutomationFailure> {
  return Effect.gen(function* () {
    let latest: string | undefined;

    for (const value of tags) {
      const tag = yield* decode(RepositoryTagSchema, value, 'GitLab repository tag response is invalid');

      if (!tag.name.startsWith('v')) continue;

      const version = tag.name.slice(1);

      if (!isStableReleaseVersion(version)) continue;

      if (latest === undefined || compareStableReleaseVersions(version, latest) > 0) latest = version;
    }

    return latest;
  });
}

function protectedPatternMatches(pattern: string, tagName: string): boolean {
  const expression = new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*')}$`);

  return expression.test(tagName);
}

function isAbsentOrNull(value: number | null | undefined): boolean {
  return value === undefined || value === null;
}

function isDedicatedDeployKeyGrant(access: typeof ProtectedTagAccessSchema.Type, deployKeyId: number): boolean {
  return (
    access.deploy_key_id === deployKeyId &&
    isAbsentOrNull(access.user_id) &&
    isAbsentOrNull(access.group_id) &&
    (isAbsentOrNull(access.access_level) || access.access_level === 0 || access.access_level === 40)
  );
}

function allowsOnlyReleaseDeployKey(
  levels: readonly (typeof ProtectedTagAccessSchema.Type)[],
  deployKeyId: number,
): boolean {
  if (levels.length !== 1) return false;

  const [access] = levels;

  return access !== undefined && isDedicatedDeployKeyGrant(access, deployKeyId);
}

export function assertProtectedTagAccess(
  api: GitLabClient,
  tagName: string,
  deployKeyId: number,
): Effect.Effect<void, ReleaseAutomationFailure> {
  return Effect.gen(function* () {
    const rawRules = yield* api.listPages('/protected_tags');

    const rules = yield* Effect.forEach(rawRules, (value) =>
      decode(ProtectedTagSchema, value, 'GitLab protected-tag response is invalid'),
    );

    const matchingRules = rules.filter((rule) => protectedPatternMatches(rule.name, tagName));

    if (matchingRules.length === 0) {
      return yield* Effect.fail(new ReleaseAutomationFailure('No protected-tag rule covers this release tag'));
    }

    if (matchingRules.length > 1) {
      return yield* Effect.fail(new ReleaseAutomationFailure('Only one protected-tag rule may cover this release tag'));
    }

    if (matchingRules.some((rule) => !allowsOnlyReleaseDeployKey(rule.create_access_levels, deployKeyId))) {
      return yield* Effect.fail(
        new ReleaseAutomationFailure(
          'Every matching protected-tag rule must allow only the configured release deploy key',
        ),
      );
    }
  });
}

function tagMatchesReleaseReceipt(tag: typeof TagSchema.Type, receipt: ReleaseTagReceipt): boolean {
  const metadata = releaseMetadataFromTagMessage(tag.message);

  return (
    tag.name === receipt.tag &&
    tag.commit.id === receipt.commitSha &&
    tag.protected &&
    metadata !== undefined &&
    metadata.version === receipt.version &&
    metadata.tag === receipt.tag &&
    metadata.commitSha === receipt.commitSha &&
    metadata.pipelineId === receipt.pipelineId
  );
}

function matchesExistingReleaseTag(
  value: Schema.Json,
  receipt: ReleaseTagReceipt,
): Effect.Effect<boolean, ReleaseAutomationFailure> {
  if (value === null) return Effect.succeed(false);

  return decode(TagSchema, value, 'Existing release tag response is invalid').pipe(
    Effect.flatMap((tag) => {
      if (!tagMatchesReleaseReceipt(tag, receipt)) {
        return Effect.fail(
          new ReleaseAutomationFailure(`Release tag ${receipt.tag} already exists with conflicting release identity`),
        );
      }

      return Effect.succeed(true);
    }),
  );
}

function assertReleaseVersionProgression(
  version: string,
  latest: string | undefined,
  existingMatches: boolean,
): Effect.Effect<boolean, ReleaseAutomationFailure> {
  if (latest === undefined) {
    if (existingMatches) {
      return Effect.fail(
        new ReleaseAutomationFailure('Existing release tag is absent from the latest stable release history'),
      );
    }

    return Effect.succeed(false);
  }

  const comparison = compareStableReleaseVersions(version, latest);

  if (comparison < 0) {
    return Effect.fail(new ReleaseAutomationFailure('Release version must be newer than the latest release tag'));
  }

  if (comparison === 0) {
    if (!existingMatches) {
      return Effect.fail(
        new ReleaseAutomationFailure('Release version already exists without the exact immutable tag receipt'),
      );
    }

    return Effect.succeed(true);
  }

  if (existingMatches) {
    return Effect.fail(
      new ReleaseAutomationFailure('Existing release tag is absent from the latest stable release history'),
    );
  }

  return Effect.succeed(false);
}

export function assertLatestReleaseVersion(
  api: GitLabClient,
  receipt: ReleaseTagReceipt,
): Effect.Effect<boolean, ReleaseAutomationFailure> {
  return Effect.gen(function* () {
    const existing = yield* api.request(`/repository/tags/${encodeURIComponent(receipt.tag)}`, true);
    const existingMatches = yield* matchesExistingReleaseTag(existing, receipt);
    const tags = yield* api.listPages('/repository/tags');
    const latest = yield* latestStableReleaseVersion(tags);

    return yield* assertReleaseVersionProgression(receipt.version, latest, existingMatches);
  });
}
