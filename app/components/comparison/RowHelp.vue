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
      <!-- The size-7 target centers on the label's line box: (28 - 21) / 2 = 3.5px, (28 - 18) / 2 = 5px at text-xs. -->
      <TooltipTrigger
        type="button"
        :aria-label="`About ${label.toLowerCase()}`"
        class="relative -top-[3.5px] max-[700px]:-top-[5px] ml-1 inline-flex size-7 shrink-0 cursor-help items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
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
