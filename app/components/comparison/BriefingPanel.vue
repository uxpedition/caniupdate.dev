<script setup lang="ts">
import type { BriefingUnavailableReason, PackageBriefing } from '#shared/briefing.defs';
import type { BriefingCitation } from '~/pages/[packageName]/comparisonView';

const props = defineProps<{
  briefing: PackageBriefing | undefined;
  pending: boolean;
  error: unknown;
  citations: readonly BriefingCitation[];
}>();

const unavailableMessages: Record<BriefingUnavailableReason, string> = {
  'not-configured': 'AI briefing is not configured for this environment.',
  'invalid-config': 'AI briefing configuration is invalid.',
  'provider-error': 'The AI provider could not generate a briefing.',
  'cache-error': 'The saved AI briefing could not be read or written.',
  timeout: 'The AI briefing took too long to complete.',
  'invalid-response': 'The AI provider returned an unusable response.',
};
const citationFor = (id: string) => props.citations.find((citation) => citation.id === id);
</script>

<template>
  <section class="min-w-0 pt-4.5" aria-label="AI briefing">
    <p v-if="props.pending" class="py-4 text-xs leading-[1.7] text-muted-foreground" role="status">
      Generating the briefing. Package facts are available independently.
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
          <template v-for="id in bullet.evidenceIds" :key="id">
            <a
              v-if="citationFor(id)"
              :href="`#${citationFor(id)?.anchorId}`"
              :aria-label="`Jump to ${citationFor(id)?.label}`"
              class="text-primary underline underline-offset-[3px] focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-ring"
              >[{{ citationFor(id)?.number }}]</a
            >
          </template>
        </div>
      </li>
    </ol>
    <p v-else class="py-4 text-xs leading-[1.7] text-muted-foreground" role="status">Waiting for comparison data.</p>
  </section>
</template>
