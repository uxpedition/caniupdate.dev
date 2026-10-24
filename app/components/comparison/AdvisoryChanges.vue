<script setup lang="ts">
import { ArrowUpRight } from '@lucide/vue';
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui';
import { computed, onBeforeUnmount, ref } from 'vue';

import type { AdvisoryComparison } from '#shared/comparison/comparison.defs';
import RowViewport from '~/components/comparison/RowViewport.vue';

const props = defineProps<{ comparison: AdvisoryComparison }>();

const openGroup = ref<string | null>(null);

const openedByHover = ref(false);

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

let closeTimer: ReturnType<typeof setTimeout> | undefined;

const cancelClose = () => {
  clearTimeout(closeTimer);
  closeTimer = undefined;
};

const showGroup = (kind: string) => {
  cancelClose();
  openedByHover.value = true;
  openGroup.value = kind;
};

const setGroupOpen = (kind: string, open: boolean) => {
  cancelClose();
  openedByHover.value = false;
  openGroup.value = open ? kind : openGroup.value === kind ? null : openGroup.value;
};

const scheduleClose = () => {
  cancelClose();

  if (!openedByHover.value) return;

  closeTimer = setTimeout(() => {
    openGroup.value = null;
    closeTimer = undefined;
  }, 150);
};

onBeforeUnmount(cancelClose);
</script>

<template>
  <div class="mb-4 rounded-[6px] bg-muted p-4.5 text-xs leading-[1.7] text-foreground">
    <template v-for="(group, index) in groups" :key="group.kind">
      <span v-if="index > 0">, </span>
      <PopoverRoot
        v-if="group.entries.length"
        :open="openGroup === group.kind"
        @update:open="setGroupOpen(group.kind, $event)"
      >
        <PopoverTrigger
          type="button"
          class="cursor-help underline decoration-dotted underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          @pointerenter="$event.pointerType !== 'touch' && showGroup(group.kind)"
          @pointerleave="scheduleClose"
        >
          {{ group.entries.length }} {{ group.label }}
        </PopoverTrigger>
        <PopoverPortal>
          <PopoverContent
            side="top"
            :side-offset="6"
            :collision-padding="12"
            :aria-label="`Advisory matches ${group.label}`"
            @open-auto-focus="openedByHover && $event.preventDefault()"
            @close-auto-focus="openedByHover && $event.preventDefault()"
            @pointerenter="cancelClose"
            @pointerleave="scheduleClose"
            @focusin="
              openedByHover = false;
              cancelClose();
            "
            class="z-50 max-w-[min(480px,calc(100vw-24px))] rounded-md border border-neutral-300 bg-neutral-100 px-3 py-2 font-body text-xs leading-relaxed text-neutral-900 shadow-lg"
          >
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
          </PopoverContent>
        </PopoverPortal>
      </PopoverRoot>
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
