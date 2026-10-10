<script setup lang="ts">
import { watch } from 'vue';

import { NuxtLayout, NuxtPage, NuxtRouteAnnouncer } from '#components';
import { computed, useHead, useRoute, useSeoMeta, useState } from '#imports';
import { useCanonicalUrl } from '~/composables/useCanonicalUrl';

// Every rendered route names one canonical address under the configured origin; a page may still refine its title.
const canonicalUrl = useCanonicalUrl();

useHead({
  link: computed(() => (canonicalUrl.value === undefined ? [] : [{ rel: 'canonical', href: canonicalUrl.value }])),
});

useSeoMeta({ ogUrl: canonicalUrl });

const route = useRoute();

const homepageHeroEntry = useState('homepage-hero-entry', () => 0);

watch(
  () => route.path,
  (path, previousPath) => {
    if (path === '/' && previousPath !== '/') {
      homepageHeroEntry.value += 1;
    }
  },
);
</script>

<template>
  <NuxtRouteAnnouncer />
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
