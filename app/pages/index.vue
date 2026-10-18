<script setup lang="ts">
import { FileCode, Gauge, Network, Shield } from '@lucide/vue';

import { useHead, useNuxtApp, useRuntimeConfig, useSeoMeta, useState } from '#imports';
import { absoluteUrl } from '#shared/site/siteUrl';
import ComparisonForm from '~/components/comparison/ComparisonForm.vue';
import SiteFooter from '~/components/SiteFooter.vue';

const homepageHeroEntry = useState('homepage-hero-entry', () => 0);

const showFormIntro = useNuxtApp().isHydrating === true;

const title = 'Compare npm Package Versions | Can I Update?';

const description =
  'Compare two versions of one public npm package. Review dependency changes, bundle estimates, and known security advisories. This does not guarantee compatibility.';

const siteUrl = useRuntimeConfig().public.siteUrl;

const homepageUrl = siteUrl === '' ? undefined : absoluteUrl(siteUrl, '/');

const applicationId = homepageUrl === undefined ? undefined : `${homepageUrl}#application`;

useHead({
  script: [
    {
      key: 'homepage-structured-data',
      type: 'application/ld+json',
      textContent: {
        '@context': 'https://schema.org',
        '@graph': [
          {
            '@type': 'WebSite',
            '@id': homepageUrl === undefined ? undefined : `${homepageUrl}#website`,
            name: 'Can I Update?',
            description,
            url: homepageUrl,
            mainEntity: applicationId === undefined ? undefined : { '@id': applicationId },
          },
          {
            '@type': 'WebApplication',
            '@id': applicationId,
            name: 'Can I Update?',
            description,
            url: homepageUrl,
          },
        ],
      },
    },
  ],
});

const image = siteUrl === '' ? undefined : absoluteUrl(siteUrl, '/social-preview.png');

useSeoMeta({
  title,
  description,
  ogType: 'website',
  ogSiteName: 'Can I Update?',
  ogTitle: title,
  ogDescription: description,
  ogImage: image,
  ogImageType: image === undefined ? undefined : 'image/png',
  ogImageWidth: image === undefined ? undefined : 1200,
  ogImageHeight: image === undefined ? undefined : 630,
  ogImageAlt:
    image === undefined
      ? undefined
      : 'Compare two versions of one public npm package. The evidence you need to make an informed update decision.',
  twitterCard: 'summary_large_image',
  twitterTitle: title,
  twitterDescription: description,
  twitterImage: image,
  twitterImageAlt:
    image === undefined
      ? undefined
      : 'Compare two versions of one public npm package. The evidence you need to make an informed update decision.',
});
</script>

<template>
  <div class="flex min-h-svh flex-col bg-background text-foreground">
    <main class="flex flex-1 flex-col px-4 py-6 sm:px-6">
      <div class="mx-auto flex min-h-[calc(100svh-9rem)] w-full max-w-6xl flex-1 flex-col justify-center pb-16">
        <Transition appear name="homepage-hero">
          <header :key="homepageHeroEntry" class="mx-auto max-w-2xl space-y-4 text-center">
            <p class="font-mono font-semibold tracking-[-0.04em]">
              can i update<span class="text-change" aria-hidden="true">?</span>
            </p>
            <h1 class="text-4xl font-medium tracking-tight sm:text-6xl">
              Check what changes before you update an npm package.
            </h1>
          </header>
        </Transition>

        <Transition :appear="showFormIntro" name="homepage-form-intro">
          <section class="mx-auto mt-10 w-full max-w-5xl">
            <ComparisonForm variant="home" />
          </section>
        </Transition>
      </div>
      <Transition appear name="homepage-form-intro">
        <div
          :key="homepageHeroEntry"
          class="mx-auto mb-10 w-full max-w-5xl overflow-hidden rounded-md border border-border bg-muted/50 text-sm leading-6"
        >
          <section aria-labelledby="comparison-scope">
            <h2
              id="comparison-scope"
              class="border-b border-border bg-muted px-4 py-4 font-mono text-base font-semibold uppercase tracking-tight sm:px-6"
            >
              What gets compared?
            </h2>
            <p class="mt-6 px-4 text-muted-foreground sm:px-6">
              Package changes, side by side. Follow the sources for a closer look.
            </p>

            <dl class="mt-6 grid border-y border-border sm:grid-cols-2">
              <div class="border-border sm:border-r">
                <dt class="flex items-center gap-3 border-b border-border bg-muted px-4 py-3 font-mono font-semibold">
                  <Network class="size-4 shrink-0 text-change" aria-hidden="true" />
                  Dependencies &amp; Node
                </dt>
                <dd class="p-4 text-muted-foreground">
                  See changes to runtime and optional dependencies, along with the package’s declared Node version
                  range.
                </dd>
              </div>
              <div class="border-t border-border sm:border-t-0">
                <dt class="flex items-center gap-3 border-b border-border bg-muted px-4 py-3 font-mono font-semibold">
                  <Gauge class="size-4 shrink-0 text-change" aria-hidden="true" />
                  Bundle estimates
                </dt>
                <dd class="p-4 text-muted-foreground">
                  Compare Bundlephobia’s gzip estimates for the package in isolation. App bundle sizes will vary.
                </dd>
              </div>
              <div class="border-t border-border sm:border-r">
                <dt class="flex items-center gap-3 border-b border-border bg-muted px-4 py-3 font-mono font-semibold">
                  <Shield class="size-4 shrink-0 text-change" aria-hidden="true" />
                  Security advisories
                </dt>
                <dd class="p-4 text-muted-foreground">
                  Check advisory matches from OSV, with links to the sources. Incomplete coverage leaves security
                  questions open.
                </dd>
              </div>
              <div class="border-t border-border">
                <dt class="flex items-center gap-3 border-b border-border bg-muted px-4 py-3 font-mono font-semibold">
                  <FileCode class="size-4 shrink-0 text-change" aria-hidden="true" />
                  Exports, types &amp; releases
                </dt>
                <dd class="p-4 text-muted-foreground">
                  Explore published declarations and collected maintainer notes for changes worth investigating. These
                  cover part of the picture, rather than every API or behavior change.
                </dd>
              </div>
            </dl>

            <p class="mx-4 my-6 text-muted-foreground sm:mx-6">
              Package-level evidence is a starting point, not a compatibility guarantee. Missing evidence leaves open
              questions. Optional AI notes add context to the facts.
            </p>
          </section>

          <section aria-labelledby="comparison-steps" class="mt-8 pb-6">
            <h2
              id="comparison-steps"
              class="border-y border-border bg-muted px-4 py-4 font-mono text-base font-semibold uppercase tracking-tight sm:px-6"
            >
              How to use it
            </h2>
            <ol class="mx-4 mt-6 grid gap-6 sm:mx-6 sm:grid-cols-3" role="list">
              <li class="space-y-2 border-l-2 border-border pl-4">
                <div class="flex items-baseline gap-3">
                  <span class="font-mono text-change" aria-hidden="true">01</span>
                  <h3 class="font-mono font-semibold">Find a package</h3>
                </div>
                <p class="text-muted-foreground">Search by its public npm name.</p>
              </li>
              <li class="space-y-2 border-l-2 border-border pl-4">
                <div class="flex items-baseline gap-3">
                  <span class="font-mono text-change" aria-hidden="true">02</span>
                  <h3 class="font-mono font-semibold">Pick two versions</h3>
                </div>
                <p class="text-muted-foreground">Choose a starting point and a target, then compare.</p>
              </li>
              <li class="space-y-2 border-l-2 border-border pl-4">
                <div class="flex items-baseline gap-3">
                  <span class="font-mono text-change" aria-hidden="true">03</span>
                  <h3 class="font-mono font-semibold">Explore the changes</h3>
                </div>
                <p class="text-muted-foreground">Follow the details and sources to plan what to test.</p>
              </li>
            </ol>
          </section>
        </div>
      </Transition>
    </main>
    <Transition appear name="homepage-form-intro">
      <div :key="homepageHeroEntry">
        <SiteFooter />
      </div>
    </Transition>
  </div>
</template>

<style>
.homepage-hero-appear-active,
.homepage-hero-enter-active {
  transition:
    opacity 320ms ease,
    transform 320ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

.homepage-hero-appear-from,
.homepage-hero-enter-from {
  opacity: 0;
  transform: translateY(12px);
}

.homepage-form-intro-appear-active,
.homepage-form-intro-enter-active {
  transition:
    opacity 400ms ease 60ms,
    transform 400ms cubic-bezier(0.2, 0.8, 0.2, 1) 60ms;
}

.homepage-form-intro-appear-from,
.homepage-form-intro-enter-from {
  opacity: 0;
  transform: translateY(12px);
}

@media (prefers-reduced-motion: reduce) {
  .homepage-form-intro-appear-active,
  .homepage-form-intro-enter-active,
  .homepage-hero-appear-active,
  .homepage-hero-enter-active {
    transition: none !important;
  }

  .homepage-form-intro-appear-from,
  .homepage-form-intro-enter-from,
  .homepage-hero-appear-from,
  .homepage-hero-enter-from {
    opacity: 1;
    transform: none;
  }
}
</style>
