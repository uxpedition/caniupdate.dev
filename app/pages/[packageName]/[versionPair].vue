<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import { definePageMeta, useNuxtApp, useRoute, useSeoMeta } from '#imports';
import type { TraceContext } from '#shared/telemetry/traceContext.defs';
import ComparisonDetails from '~/components/comparison/ComparisonDetails.vue';
import LoadingMessage from '~/components/element/LoadingMessage.vue';
import { openComparisonPage } from '~/composables/comparisonPageTelemetry';
import { useComparisonRoute } from '~/composables/useComparisonRoute';

definePageMeta({ layout: 'site' });

const route = useRoute();

const telemetry = useNuxtApp().$telemetry;

const pageTraceContext = ref<TraceContext>();

// Route-only content can stream before declarations; the description streams with ComparisonDetails.
const { packageName, fromVersion, toVersion } = useComparisonRoute();

useSeoMeta({
  title: computed(() => `${packageName.value} ${fromVersion.value} -> ${toVersion.value} · Can I Update?`),
});

if (import.meta.client) {
  watch(
    () => route.path,
    () => {
      if (route.name === 'packageName-versionPair') {
        pageTraceContext.value = openComparisonPage(telemetry, packageName.value, {
          from: fromVersion.value,
          to: toVersion.value,
        });
      }
    },
    { immediate: true },
  );
}
</script>

<template>
  <Transition appear name="comparison-content">
    <div
      :key="route.path"
      class="comparison-shell mx-auto max-w-[1040px] px-10 pt-14 pb-10 max-[700px]:px-5 max-[700px]:py-[30px]"
    >
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
        <ComparisonDetails :page-trace-context="pageTraceContext" />
      </Suspense>
    </div>
  </Transition>
</template>

<style>
.comparison-content-appear-active,
.comparison-content-enter-active {
  transition:
    opacity 180ms ease 120ms,
    transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1) 120ms;
}

.comparison-content-appear-from,
.comparison-content-enter-from {
  opacity: 0;
  transform: translateY(16px);
}

@media (prefers-reduced-motion: reduce) {
  .comparison-content-appear-active,
  .comparison-content-enter-active {
    transition: none !important;
  }

  .comparison-content-appear-from,
  .comparison-content-enter-from {
    opacity: 1;
    transform: none;
  }
}
</style>
