<script setup lang="ts">
import { Info } from '@lucide/vue';
import { TooltipContent, TooltipPortal, TooltipProvider, TooltipRoot, TooltipTrigger } from 'reka-ui';
import { ref } from 'vue';

defineProps<{ label: string; explanation: string }>();
const open = ref(false);
</script>

<template>
  <TooltipProvider :delay-duration="200">
    <TooltipRoot v-model:open="open" disable-closing-trigger>
      <TooltipTrigger
        type="button"
        :aria-label="`About ${label.toLowerCase()}`"
        class="ml-1 inline-flex size-7 shrink-0 cursor-help items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        @click="open = !open"
      >
        <Info :size="14" aria-hidden="true" />
      </TooltipTrigger>
      <TooltipPortal>
        <TooltipContent
          side="top"
          :side-offset="6"
          :collision-padding="12"
          class="z-50 max-w-[min(320px,calc(100vw-24px))] rounded-md border border-neutral-300 bg-neutral-100 px-3 py-2 font-body text-xs leading-relaxed text-neutral-900 shadow-lg"
        >
          {{ explanation }}
        </TooltipContent>
      </TooltipPortal>
    </TooltipRoot>
  </TooltipProvider>
</template>
