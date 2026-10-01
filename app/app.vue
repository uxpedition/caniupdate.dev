<script setup lang="ts">
import { NuxtLayout, NuxtPage, NuxtRouteAnnouncer } from '#components';
import { computed, useHead, useSeoMeta } from '#imports';
import { useCanonicalUrl } from '~/composables/useCanonicalUrl';

// Every rendered route names one canonical address under the configured origin; a page may still refine its title.
const canonicalUrl = useCanonicalUrl();

useHead({
  link: computed(() => (canonicalUrl.value === undefined ? [] : [{ rel: 'canonical', href: canonicalUrl.value }])),
});
useSeoMeta({ ogUrl: canonicalUrl });
</script>

<template>
  <NuxtRouteAnnouncer />
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
