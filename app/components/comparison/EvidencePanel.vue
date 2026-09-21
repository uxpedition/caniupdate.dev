<script setup lang="ts">
import type { BriefingSource } from '#shared/briefing.defs';
import { citationAnchorId, type BriefingCitation } from '~/pages/[packageName]/comparisonView';

const props = defineProps<{
  sources: readonly BriefingSource[];
  citations: readonly BriefingCitation[];
}>();
</script>

<template>
  <section v-if="props.sources.length" class="mt-6 min-w-0" aria-label="Evidence index">
    <ol class="list-none p-0">
      <li
        v-for="source in props.sources"
        :id="source.id.startsWith('comparison.') ? undefined : citationAnchorId(source.id)"
        :key="source.id"
        class="scroll-mt-16"
      >
        <details>
          <summary
            class="cursor-pointer py-3 text-xs leading-[1.5] wrap-anywhere focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-ring"
          >
            <span v-if="props.citations.find((citation) => citation.id === source.id)" class="font-mono"
              >[{{ props.citations.find((citation) => citation.id === source.id)?.number }}]</span
            >
            {{ source.label }}
            <small class="ml-2 font-mono text-[0.625rem] leading-[normal] uppercase text-muted-foreground">{{
              source.kind
            }}</small>
          </summary>
          <pre
            class="max-h-80 overflow-auto bg-muted p-3 font-mono text-[0.6875rem]/[1.7] whitespace-pre-wrap wrap-anywhere"
            >{{ source.text }}</pre>
          <ul v-if="source.urls.length" class="list-none px-0 py-3">
            <li v-for="url in source.urls" :key="url">
              <a
                :href="url"
                target="_blank"
                rel="noreferrer"
                class="text-primary text-[0.6875rem] wrap-anywhere underline underline-offset-[3px] focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-ring"
                >{{ url }}</a
              >
            </li>
          </ul>
        </details>
      </li>
    </ol>
  </section>
</template>
