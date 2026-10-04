<script setup lang="ts">
import { BetweenVerticalStart } from '@lucide/vue';
import { computed } from 'vue';

import { useRouter } from '#imports';
import ComparisonForm from '~/components/comparison/ComparisonForm.vue';
import Button from '~/components/element/Button.vue';
import SiteFooter from '~/components/SiteFooter.vue';

const router = useRouter();
const isComparisonRoute = computed(
  () =>
    typeof router.currentRoute.value.params.packageName === 'string' &&
    typeof router.currentRoute.value.params.versionPair === 'string',
);
</script>

<template>
  <div class="flex min-h-svh flex-col bg-background font-body text-foreground">
    <nav class="w-full border-b border-b-border/55" aria-label="Site navigation">
      <div
        class="mx-auto flex max-w-[1040px] flex-wrap items-center justify-between gap-6 px-10 py-[25px] text-[13px] leading-normal max-[900px]:gap-y-3 max-[700px]:gap-x-3 max-[700px]:px-5 max-[700px]:py-5 max-[700px]:text-[11px] max-[700px]:leading-normal"
      >
        <NuxtLink
          to="/"
          class="font-mono font-semibold tracking-[-0.04em] hover:underline hover:underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-[5px] focus-visible:outline-ring"
          >can i update<span class="text-change" aria-hidden="true">?</span></NuxtLink
        >
        <ComparisonForm
          v-if="isComparisonRoute"
          variant="header"
          class="ml-auto min-w-0 max-w-[820px] flex-1 max-[900px]:order-3 max-[900px]:ml-0 max-[900px]:basis-full max-[900px]:max-w-none"
        />
        <div v-else class="flex gap-6 text-muted-foreground max-[700px]:gap-4">
          <Button as-child size="sm">
            <a href="/"><BetweenVerticalStart aria-hidden="true" />New comparison</a>
          </Button>
        </div>
      </div>
    </nav>

    <main class="flex-1">
      <slot />
    </main>
    <SiteFooter />
  </div>
</template>
