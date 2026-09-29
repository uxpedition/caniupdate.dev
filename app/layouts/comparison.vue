<script setup lang="ts">
import { BetweenVerticalStart } from '@lucide/vue';

import Button from '~/components/element/Button.vue';
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

    <slot />
  </main>
</template>
