<script setup lang="ts">
import { ArrowUpRight } from '@lucide/vue';
import { computed, ref } from 'vue';

import type { AdvisoryComparison } from '#shared/comparison/comparison.defs';
import RowViewport from '~/components/comparison/RowViewport.vue';
import HoverPopover from '~/components/element/HoverPopover.vue';

const props = defineProps<{ comparison: AdvisoryComparison }>();

const openGroup = ref<string | null>(null);

const groups = computed(() =>
  props.comparison.status === 'available'
    ? [
        { kind: 'previous', label: 'only in previous', entries: props.comparison.fromOnly },
        { kind: 'new', label: 'only in new', entries: props.comparison.toOnly },
        { kind: 'both', label: 'present in both', entries: props.comparison.both },
      ]
    : [
        { kind: 'uncertain', label: 'unconfirmed', entries: props.comparison.uncertain },
        { kind: 'both', label: 'present in both', entries: props.comparison.both },
      ],
);
</script>

<template>
  <div class="mb-4 rounded-[6px] bg-muted p-4.5 text-xs leading-[1.7] text-foreground">
    <template v-for="(group, index) in groups" :key="group.kind">
      <span v-if="index > 0">, </span>
      <HoverPopover
        v-if="group.entries.length"
        :open="openGroup === group.kind"
        :label="`Advisory matches ${group.label}`"
        @update:open="openGroup = $event ? group.kind : openGroup === group.kind ? null : openGroup"
      >
        <template #trigger>{{ group.entries.length }} {{ group.label }}</template>
        <RowViewport :count="group.entries.length" rows="li" :label="`Advisory matches ${group.label}`">
          <ul class="space-y-2">
            <li v-for="entry in group.entries" :key="entry.ids.join(',')" class="wrap-anywhere">
              <div class="flex flex-wrap gap-x-3 gap-y-1">
                <a
                  v-for="id in entry.ids"
                  :key="id"
                  :href="`https://osv.dev/vulnerability/${encodeURIComponent(id)}`"
                  target="_blank"
                  rel="noreferrer"
                  class="underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {{ id }}
                  <ArrowUpRight :size="12" class="inline-block" aria-hidden="true" />
                  <span class="sr-only"> (OSV advisory, opens in a new tab)</span>
                </a>
              </div>
              <span v-if="group.kind === 'uncertain'" class="block">
                {{
                  entry.from.length
                    ? 'Matched in previous · exclusivity unconfirmed'
                    : 'Matched in new · exclusivity unconfirmed'
                }}
              </span>
            </li>
          </ul>
        </RowViewport>
      </HoverPopover>
      <span v-else-if="comparison.status === 'available'">0 {{ group.label }}</span>
      <span v-else-if="group.kind === 'both'">No shared matches confirmed</span>
      <span v-else>Advisory differences unavailable</span>
    </template>
    <p class="mt-1 text-muted-foreground">
      <template v-if="comparison.status !== 'available'">
        Coverage is incomplete; one-sided matches cannot be confirmed as exclusive.
      </template>
      <template v-else>Match differences do not establish fixes or newly introduced issues.</template>
      Counts group advisory records for the same issue.
    </p>
  </div>
</template>
