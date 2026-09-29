<script setup lang="ts">
import { BetweenVerticalStart } from '@lucide/vue';

import ComparisonDetails from '~/components/comparison/ComparisonDetails.vue';
import Button from '~/components/element/Button.vue';
import LoadingMessage from '~/components/element/LoadingMessage.vue';
import { useComparisonRoute } from '~/composables/useComparisonRoute';

// Route-only content can stream before declarations; the description streams with ComparisonDetails.
const { packageName, fromVersion, toVersion } = useComparisonRoute();
</script>

<template>
  <main class="min-h-svh bg-background font-body text-foreground">
    <nav class="w-full border-b border-b-border/55" aria-label="Comparison navigation">
      <div
        class="mx-auto flex max-w-[1040px] items-center justify-between gap-6 px-10 py-[25px] text-[13px] leading-normal max-[700px]:gap-3 max-[700px]:px-5 max-[700px]:py-5 max-[700px]:text-[11px] max-[700px]:leading-normal"
      >
        <a
          href="/"
          class="font-mono font-semibold tracking-[-0.04em] hover:underline hover:underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-[5px] focus-visible:outline-ring"
          >can i update<span class="text-change" aria-hidden="true">?</span></a
        >
        <div class="flex gap-6 text-muted-foreground max-[700px]:gap-4">
          <Button as-child size="sm">
            <a href="/"><BetweenVerticalStart aria-hidden="true" />New comparison</a>
          </Button>
        </div>
      </div>
    </nav>

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
  </main>
</template>
