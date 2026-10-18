<script setup lang="ts">
import { useNuxtApp, useRuntimeConfig, useSeoMeta, useState } from '#imports';
import { absoluteUrl } from '#shared/site/siteUrl';
import ComparisonForm from '~/components/comparison/ComparisonForm.vue';
import SiteFooter from '~/components/SiteFooter.vue';

const homepageHeroEntry = useState('homepage-hero-entry', () => 0);

const showFormIntro = useNuxtApp().isHydrating === true;

const title = 'Compare npm Package Versions | Can I Update?';

const description =
  'Compare two versions of one public npm package. Review dependency changes, bundle estimates, and known security advisories—not a guarantee of compatibility.';

const siteUrl = useRuntimeConfig().public.siteUrl;

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
      <div class="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center pb-16">
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
    </main>
    <SiteFooter />
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
