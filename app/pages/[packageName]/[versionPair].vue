<script setup lang="ts">
import { computed } from 'vue';

import { definePageMeta, useSeoMeta } from '#imports';
import ComparisonDetails from '~/components/comparison/ComparisonDetails.vue';
import LoadingMessage from '~/components/element/LoadingMessage.vue';
import { useComparisonRoute } from '~/composables/useComparisonRoute';

definePageMeta({ layout: 'site' });

// Route-only content can stream before declarations; the description streams with ComparisonDetails.
const { packageName, fromVersion, toVersion } = useComparisonRoute();
useSeoMeta({
  title: computed(() => `${packageName.value} ${fromVersion.value} -> ${toVersion.value} · Can I Update?`),
});
</script>

<template>
  <div class="comparison-shell mx-auto max-w-[1040px] px-10 pt-14 pb-10 max-[700px]:px-5 max-[700px]:py-[30px]">
    <header>
      <p class="mb-2.5 text-xs leading-normal text-muted-foreground">Release comparison</p>
      <p class="mb-2.5 flex flex-wrap items-center gap-3.5 font-mono text-[15px] leading-[1.5] text-muted-foreground">
        <span>{{ fromVersion }}</span
        ><span aria-hidden="true">→</span><span class="sr-only">to</span
        ><strong class="font-medium text-foreground">{{ toVersion }}</strong>
      </p>
      <h1 class="font-mono text-[clamp(28px,4vw,40px)] leading-[1.2] font-semibold tracking-[-0.06em] wrap-anywhere">
        {{ packageName }}
      </h1>
    </header>

    <!-- The loader stays until streamed or client-fetched comparison content is present. -->
    <LoadingMessage
      data-comparison-loading
      as="p"
      loading-text="Reading package declarations…"
      class="mt-11 py-[30px] leading-[1.8] max-[700px]:mt-8"
    />

    <Suspense>
      <ComparisonDetails />
    </Suspense>
  </div>
</template>
