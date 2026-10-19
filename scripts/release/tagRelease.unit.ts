import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { GitLabClient } from './gitlabApi.ts';
import { releaseTagMessage } from './metadata.ts';
import { assertReleaseTagContext, createReleaseTag, type ReleaseTagInput } from './tagRelease.ts';
import { ReleaseAutomationFailure } from './version.ts';

const COMMIT_SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);
const PIPELINE_ID = '4711';
const JOB_ID = '991';
const CHILD_PIPELINE_ID = 4712;
const VERSION = '1.2.3';
const TAG = `v${VERSION}`;
const DEPLOY_KEY_ID = 77;
const MESSAGE = releaseTagMessage({ version: VERSION, tag: TAG, commitSha: COMMIT_SHA, pipelineId: PIPELINE_ID });

type ApiCall = { readonly path: string; readonly allowMissing?: boolean };

class ReleaseTagApi implements GitLabClient {
  readonly calls: ApiCall[] = [];
  mainSha = COMMIT_SHA;
  mainProtected = true;
  actorAccessLevel = 40;
  pipeline = { id: Number(PIPELINE_ID), status: 'running', source: 'push', ref: 'main', sha: COMMIT_SHA };
  stagePipeline = { id: CHILD_PIPELINE_ID, status: 'success', source: 'parent_pipeline', ref: 'main', sha: COMMIT_SHA };
  releaseJobStatus = 'running';
  parentJobs: unknown[] = [
    { name: 'quality', status: 'success', allow_failure: false },
    { name: 'unit-tests', status: 'success', allow_failure: false },
    { name: 'build-smoke', status: 'success', allow_failure: false },
    { name: 'smoke:built', status: 'success', allow_failure: false },
  ];
  stageJobs: unknown[] = [
    { name: 'deploy:stage', status: 'success', allow_failure: false },
    { name: 'verify:stage: [chromium]', status: 'success', allow_failure: false },
    { name: 'verify:stage: [firefox]', status: 'success', allow_failure: false },
  ];
  latestTags: unknown[] = [{ name: 'v1.2.2', commit: { id: OTHER_SHA } }];
  protectedTagRules: unknown[] = [
    {
      name: 'v*',
      create_access_levels: [{ deploy_key_id: DEPLOY_KEY_ID, access_level: 40, user_id: null, group_id: null }],
    },
  ];
  existingTag: unknown | null = null;

  request(path: string, allowMissing = false): Effect.Effect<unknown, ReleaseAutomationFailure> {
    const api = this;

    return Effect.gen(function* () {
      yield* Effect.sync(() => api.calls.push({ path, allowMissing }));

      if (path === '/repository/branches/main') {
        return { name: 'main', protected: api.mainProtected, commit: { id: api.mainSha } };
      }

      if (path === `/pipelines/${PIPELINE_ID}`) return api.pipeline;

      if (path === `/jobs/${JOB_ID}`) {
        return {
          id: Number(JOB_ID),
          name: 'release:tag',
          status: api.releaseJobStatus,
          pipeline: { id: Number(PIPELINE_ID) },
          user: { id: 42, username: 'maintainer' },
        };
      }

      if (path === '/members/all/42') return { id: 42, access_level: api.actorAccessLevel };
      if (path === `/repository/tags/${TAG}`) return api.existingTag;
      if (path === `/pipelines/${CHILD_PIPELINE_ID}`) return api.stagePipeline;

      return yield* Effect.fail(new ReleaseAutomationFailure(`Unexpected fake GitLab request: ${path}`));
    });
  }

  listPages(path: string): Effect.Effect<readonly unknown[], ReleaseAutomationFailure> {
    if (path === `/pipelines/${PIPELINE_ID}/jobs?include_retried=false`) return Effect.succeed(this.parentJobs);

    if (path === `/pipelines/${PIPELINE_ID}/bridges`) {
      return Effect.succeed([
        {
          name: 'stage:delivery',
          status: 'success',
          allow_failure: false,
          downstream_pipeline: { id: CHILD_PIPELINE_ID },
        },
      ]);
    }

    if (path === `/pipelines/${CHILD_PIPELINE_ID}/jobs?include_retried=false`) return Effect.succeed(this.stageJobs);
    if (path === '/repository/tags') return Effect.succeed(this.latestTags);
    if (path === '/protected_tags') return Effect.succeed(this.protectedTagRules);

    return Effect.fail(new ReleaseAutomationFailure(`Unexpected fake GitLab listing: ${path}`));
  }
}

function tagInput(overrides: Partial<ReleaseTagInput> = {}): ReleaseTagInput {
  return {
    version: VERSION,
    commitSha: COMMIT_SHA,
    pipelineId: PIPELINE_ID,
    jobId: JOB_ID,
    buildIdentityContents: JSON.stringify({
      commitSha: COMMIT_SHA,
      pipelineId: PIPELINE_ID,
      bundles: { frontend: '1'.repeat(64), evidence: '2'.repeat(64), briefing: '3'.repeat(64) },
      artifactSha256: '4'.repeat(64),
    }),
    deployKeyId: String(DEPLOY_KEY_ID),
    privateKeyFile: '/fixture/release-key',
    ...overrides,
  };
}

function tagContext(overrides: Partial<NodeJS.ProcessEnv> = {}): NodeJS.ProcessEnv {
  return {
    CI_SERVER_HOST: 'gitlab.com',
    CI_PROJECT_ID: '86537464',
    CI_PROJECT_PATH: 'uxpedition/caniupdate.dev',
    CI_PIPELINE_SOURCE: 'push',
    CI_COMMIT_BRANCH: 'main',
    CI_COMMIT_REF_PROTECTED: 'true',
    CI_JOB_MANUAL: 'true',
    CI_JOB_NAME: 'release:tag',
    CI_JOB_ID: JOB_ID,
    CI_PIPELINE_ID: PIPELINE_ID,
    CI_COMMIT_SHA: COMMIT_SHA,
    CI_ENVIRONMENT_NAME: 'release-tag',
    RELEASE_VERSION: VERSION,
    ...overrides,
  };
}

describe('manual protected-main release tagging', () => {
  it('accepts only the manual release-tag job in a protected main push pipeline', async () => {
    await expect(Effect.runPromise(assertReleaseTagContext(tagContext()))).resolves.toBeUndefined();

    for (const overrides of [
      { CI_PIPELINE_SOURCE: 'merge_request_event' },
      { CI_COMMIT_BRANCH: 'feature/release' },
      { CI_COMMIT_REF_PROTECTED: 'false' },
      { CI_JOB_MANUAL: 'false' },
      { CI_JOB_NAME: 'deploy:production' },
      { CI_ENVIRONMENT_NAME: 'production' },
      { RELEASE_VERSION: '1.2.3-rc.1' },
    ]) {
      await expect(Effect.runPromise(assertReleaseTagContext(tagContext(overrides)))).rejects.toBeInstanceOf(
        ReleaseAutomationFailure,
      );
    }
  });

  it('tags only after API evidence confirms this protected main pipeline, successful stage browsers, and a Maintainer actor', async () => {
    const api = new ReleaseTagApi();
    const published: string[] = [];
    const receipts: string[] = [];

    const result = await Effect.runPromise(
      createReleaseTag(
        tagInput(),
        api,
        (contents) =>
          Effect.sync(() => {
            receipts.push(contents);
          }),
        (version, sha, message) =>
          Effect.sync(() => {
            published.push(`${version}:${sha}`);
            api.latestTags = [{ name: `v${version}`, commit: { id: sha } }, ...api.latestTags];
            api.existingTag = {
              name: `v${version}`,
              target: 'c'.repeat(40),
              commit: { id: sha },
              protected: true,
              message,
            };
          }),
      ),
    );

    expect(result).toEqual({
      version: VERSION,
      tag: TAG,
      commitSha: COMMIT_SHA,
      pipelineId: PIPELINE_ID,
      reused: false,
    });
    expect(published).toEqual([`${VERSION}:${COMMIT_SHA}`]);
    expect(JSON.parse(receipts[0] ?? '{}')).toEqual({
      version: VERSION,
      tag: TAG,
      commitSha: COMMIT_SHA,
      pipelineId: PIPELINE_ID,
    });
    expect(api.calls.map(({ path }) => path)).toContain(`/pipelines/${PIPELINE_ID}`);
    expect(api.calls.map(({ path }) => path)).toContain(`/pipelines/${CHILD_PIPELINE_ID}`);
    expect(api.calls.map(({ path }) => path)).toContain(`/jobs/${JOB_ID}`);
    expect(api.calls.map(({ path }) => path)).toContain('/members/all/42');
  });

  it.each([
    ['an unprotected main branch', (api: ReleaseTagApi) => (api.mainProtected = false)],
    ['a main branch that has advanced', (api: ReleaseTagApi) => (api.mainSha = OTHER_SHA)],
    ['a non-push pipeline', (api: ReleaseTagApi) => (api.pipeline = { ...api.pipeline, source: 'web' })],
    ['a pipeline from another ref', (api: ReleaseTagApi) => (api.pipeline = { ...api.pipeline, ref: 'release' })],
    ['a pipeline for another commit', (api: ReleaseTagApi) => (api.pipeline = { ...api.pipeline, sha: OTHER_SHA })],
    [
      'an unsuccessful unit-test gate',
      (api: ReleaseTagApi) => (api.parentJobs[1] = { name: 'unit-tests', status: 'failed', allow_failure: false }),
    ],
    ['a missing Firefox stage verification', (api: ReleaseTagApi) => (api.stageJobs = api.stageJobs.slice(0, 2))],
    ['a non-Maintainer release actor', (api: ReleaseTagApi) => (api.actorAccessLevel = 30)],
    [
      'an unsuccessful downstream stage pipeline',
      (api: ReleaseTagApi) => (api.stagePipeline = { ...api.stagePipeline, status: 'failed' }),
    ],
    [
      'a downstream stage pipeline from the wrong source',
      (api: ReleaseTagApi) => (api.stagePipeline = { ...api.stagePipeline, source: 'push' }),
    ],
    [
      'a downstream stage pipeline for another ref',
      (api: ReleaseTagApi) => (api.stagePipeline = { ...api.stagePipeline, ref: 'release' }),
    ],
    [
      'a downstream stage pipeline for another commit',
      (api: ReleaseTagApi) => (api.stagePipeline = { ...api.stagePipeline, sha: OTHER_SHA }),
    ],
    [
      'a downstream stage pipeline with another ID',
      (api: ReleaseTagApi) => (api.stagePipeline = { ...api.stagePipeline, id: CHILD_PIPELINE_ID + 1 }),
    ],
  ])('does not publish a tag with %s', async (_label, arrange) => {
    const api = new ReleaseTagApi();
    arrange(api);
    let publications = 0;

    await expect(
      Effect.runPromise(
        createReleaseTag(
          tagInput(),
          api,
          () => Effect.void,
          () =>
            Effect.sync(() => {
              publications += 1;
            }),
        ),
      ),
    ).rejects.toBeInstanceOf(ReleaseAutomationFailure);

    expect(publications).toBe(0);
  });

  it('rejects a version that does not advance the latest stable release tag', async () => {
    const api = new ReleaseTagApi();
    api.latestTags = [{ name: 'v1.3.0', commit: { id: OTHER_SHA } }];
    let publications = 0;

    await expect(
      Effect.runPromise(
        createReleaseTag(
          tagInput(),
          api,
          () => Effect.void,
          () =>
            Effect.sync(() => {
              publications += 1;
            }),
        ),
      ),
    ).rejects.toThrow('newer');

    expect(publications).toBe(0);
  });

  it('reuses only an exact existing immutable tag for this version, commit, and pipeline', async () => {
    const api = new ReleaseTagApi();
    api.latestTags = [{ name: TAG, commit: { id: COMMIT_SHA } }];
    api.existingTag = {
      name: TAG,
      target: 'd'.repeat(40),
      commit: { id: COMMIT_SHA },
      protected: true,
      message: MESSAGE,
    };
    const receipts: string[] = [];
    let publications = 0;

    const result = await Effect.runPromise(
      createReleaseTag(
        tagInput(),
        api,
        (contents) =>
          Effect.sync(() => {
            receipts.push(contents);
          }),
        () =>
          Effect.sync(() => {
            publications += 1;
          }),
      ),
    );

    expect(result.reused).toBe(true);
    expect(publications).toBe(0);
    expect(JSON.parse(receipts[0] ?? '{}')).toEqual({
      version: VERSION,
      tag: TAG,
      commitSha: COMMIT_SHA,
      pipelineId: PIPELINE_ID,
    });
  });

  it('never replaces a tag with a different commit or pipeline identity', async () => {
    const api = new ReleaseTagApi();
    api.latestTags = [{ name: TAG, commit: { id: COMMIT_SHA } }];
    api.existingTag = {
      name: TAG,
      target: 'e'.repeat(40),
      commit: { id: COMMIT_SHA },
      protected: true,
      message: releaseTagMessage({ version: VERSION, tag: TAG, commitSha: COMMIT_SHA, pipelineId: '9876' }),
    };
    let publications = 0;

    await expect(
      Effect.runPromise(
        createReleaseTag(
          tagInput(),
          api,
          () => Effect.void,
          () =>
            Effect.sync(() => {
              publications += 1;
            }),
        ),
      ),
    ).rejects.toThrow('conflicting release identity');

    expect(publications).toBe(0);
  });
});
