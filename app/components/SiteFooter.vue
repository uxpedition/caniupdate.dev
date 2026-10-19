<script setup lang="ts">
import { useAppConfig, useRuntimeConfig } from '#imports';
import { isStableReleaseVersion } from '#shared/site/releaseIdentity';
import { PRODUCTION_SITE_ORIGIN } from '#shared/site/siteUrl';

const { buildIdentity } = useAppConfig();
const runtimeConfig = useRuntimeConfig();

const productionRuntime = runtimeConfig.public.siteUrl === PRODUCTION_SITE_ORIGIN;
const stageRuntime = runtimeConfig.public.siteUrl === 'https://stage.caniupdate.dev';
const releaseVersion = runtimeConfig.public.releaseVersion;
const productionVersion = productionRuntime && isStableReleaseVersion(releaseVersion) ? `v${releaseVersion}` : null;
const commit =
  buildIdentity.commitSha === null
    ? null
    : {
        sha: buildIdentity.commitSha,
        shortSha: buildIdentity.commitSha.slice(0, 7),
        url: `${buildIdentity.repositoryUrl}/-/commit/${buildIdentity.commitSha}`,
      };
</script>

<template>
  <footer class="border-t border-border/55 font-body text-xs leading-relaxed text-muted-foreground">
    <div
      class="mx-auto flex max-w-[1040px] flex-wrap items-center justify-between gap-x-6 gap-y-3 px-10 py-6 max-[700px]:px-5"
    >
      <NuxtLink
        to="/"
        class="font-mono text-[10px] font-semibold tracking-[-0.04em] text-foreground hover:underline hover:underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-[5px] focus-visible:outline-ring"
        >can i update<span class="text-change" aria-hidden="true">?</span></NuxtLink
      >
      <span v-if="commit && (!productionRuntime || productionVersion)">
        <span :class="{ 'font-mono': productionRuntime }">{{
          productionVersion ?? (stageRuntime ? 'stage' : 'dev')
        }}</span>
        -
        <a
          :href="commit.url"
          :aria-label="`View ${productionRuntime ? 'release' : stageRuntime ? 'stage' : 'dev'} commit ${commit.sha}`"
          class="font-mono underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
          >{{ commit.shortSha }}</a
        >
      </span>
      <nav
        aria-label="Legal and contact"
        class="flex flex-wrap gap-x-6 gap-y-2 [&_a]:underline-offset-4 [&_a:hover]:underline [&_a:focus-visible]:outline-2 [&_a:focus-visible]:outline-offset-4 [&_a:focus-visible]:outline-ring"
      >
        <a href="/privacy">Privacy</a>
        <a href="/about">About</a>
        <a href="https://gitlab.com/uxpedition/caniupdate.dev/-/work_items">Issues</a>
      </nav>
    </div>
  </footer>
</template>
