<script setup lang="ts">
import { Check, CircleHelp, TriangleAlert } from '@lucide/vue';
import { TooltipContent, TooltipPortal, TooltipProvider, TooltipRoot, TooltipTrigger } from 'reka-ui';
import { computed, ref } from 'vue';

import type { SurfaceBadge } from './packageSurfaceBadges';

const props = defineProps<{ badges: readonly SurfaceBadge[] }>();

const open = ref<string | null>(null);

const externalTypes = computed(() => props.badges.find((badge) => badge.href));
</script>

<template>
  <div v-if="badges.length">
    <span class="inline-flex flex-wrap gap-1.5">
      <TooltipProvider :delay-duration="200">
        <TooltipRoot
          v-for="badge in badges"
          :key="badge.name"
          :open="open === badge.name"
          disable-closing-trigger
          disable-hoverable-content
          @update:open="open = $event ? badge.name : open === badge.name ? null : open"
        >
          <TooltipTrigger
            type="button"
            :aria-label="`${badge.name}: ${badge.warning ? 'latest external @types release deprecated; check this version' : badge.confidence === 'strong' ? 'strong metadata evidence' : 'possible; check further'}`"
            class="inline-flex cursor-help items-center gap-1 rounded-xs border border-border px-1.5 py-0.5 text-[10px] leading-normal font-medium text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            @click="open = badge.name"
          >
            <TriangleAlert v-if="badge.warning" :size="12" aria-hidden="true" />
            <Check v-else-if="badge.confidence === 'strong'" :size="12" aria-hidden="true" />
            <CircleHelp v-else :size="12" aria-hidden="true" />
            {{ badge.name }}
          </TooltipTrigger>
          <TooltipPortal>
            <TooltipContent
              side="top"
              :side-offset="6"
              :collision-padding="12"
              class="z-50 max-w-[min(320px,calc(100vw-24px))] rounded-md border border-neutral-300 bg-neutral-100 px-3 py-2 font-body text-xs leading-relaxed text-neutral-900 shadow-lg"
            >
              {{ badge.detail }}
            </TooltipContent>
          </TooltipPortal>
        </TooltipRoot>
      </TooltipProvider>
    </span>
    <a
      v-if="externalTypes"
      :href="externalTypes.href"
      target="_blank"
      rel="noopener noreferrer"
      :aria-label="`${externalTypes.packageName} on npmx; version compatibility unverified (opens in a new tab)`"
      class="mt-1 block w-fit rounded font-mono text-[11px] text-muted-foreground underline decoration-border underline-offset-4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >{{ externalTypes.packageName }}</a
    >
  </div>
</template>
