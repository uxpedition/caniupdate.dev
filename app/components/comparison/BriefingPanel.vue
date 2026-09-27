<script setup lang="ts">
import { computed } from 'vue';

import type { BriefingUnavailableReason, PackageBriefing } from '#shared/briefing.defs';
import type { BriefingStatus } from '~/composables/packageBriefingQueryOptions';
import { citationAnchorId } from '~/pages/[packageName]/comparisonCitations';

const props = defineProps<{
  briefing: PackageBriefing | undefined;
  pending: boolean;
  status?: BriefingStatus | undefined;
  error: unknown;
}>();

const pendingMessages: Record<BriefingStatus, string> = {
  queued: 'Queued for generation. Package facts are available independently.',
  running: 'Generating the briefing. Package facts are available independently.',
};
const pendingMessage = computed(() =>
  props.status === undefined
    ? 'Generating the briefing. Package facts are available independently.'
    : pendingMessages[props.status],
);

const unavailableMessages: Record<BriefingUnavailableReason, string> = {
  'not-configured': 'AI briefing is not configured for this environment.',
  'invalid-config': 'AI briefing configuration is invalid.',
  'provider-error': 'The AI provider could not generate a briefing.',
  'cache-error': 'The saved AI briefing could not be read or written.',
  timeout: 'The AI briefing took too long to complete.',
  'invalid-response': 'The AI provider returned an unusable response.',
};
/** The cited source, resolved against the briefing's own packet-ordered sources. */
const citationFor = (number: number) => {
  const briefing = props.briefing;
  if (briefing?.status !== 'available') return undefined;
  const source = briefing.sources.find((candidate) => candidate.number === number);
  return source === undefined ? undefined : { anchorId: citationAnchorId(source.id), label: source.label };
};
</script>

<template>
  <section class="min-w-0 pt-4.5" aria-label="AI briefing">
    <p v-if="props.pending" class="py-4 text-xs leading-[1.7] text-muted-foreground" role="status">
      {{ pendingMessage }}
    </p>
    <p v-else-if="props.error" class="py-4 text-xs leading-[1.7] text-muted-foreground" role="status">
      The AI briefing could not be loaded. Package facts remain available.
    </p>
    <p
      v-else-if="props.briefing?.status === 'unavailable'"
      class="py-4 text-xs leading-[1.7] text-muted-foreground"
      role="status"
    >
      {{ unavailableMessages[props.briefing.reason] }} Package facts remain available.
    </p>
    <ol v-else-if="props.briefing?.status === 'available'" class="list-none p-0">
      <li v-for="(bullet, index) in props.briefing.bullets" :key="index" class="py-2.5">
        <div class="mb-1.5 flex gap-2 font-mono text-[0.65rem] leading-[1.5] text-muted-foreground">
          <span>{{ bullet.kind }}</span
          ><span class="border-l border-border pl-2">{{ bullet.basis }}</span>
        </div>
        <p class="text-sm leading-[1.8] wrap-anywhere">{{ bullet.text }}</p>
        <div class="flex flex-wrap gap-2 font-mono text-xs leading-[1.5]">
          <template v-for="number in bullet.evidenceNumbers" :key="number">
            <a
              v-if="citationFor(number)"
              :href="`#${citationFor(number)?.anchorId}`"
              :aria-label="`Jump to ${citationFor(number)?.label}`"
              class="text-primary underline underline-offset-[3px] focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-ring"
              >[{{ number }}]</a
            >
          </template>
        </div>
      </li>
    </ol>
    <p v-else class="py-4 text-xs leading-[1.7] text-muted-foreground" role="status">Waiting for comparison data.</p>
  </section>
</template>
