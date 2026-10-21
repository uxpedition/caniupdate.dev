<script setup lang="ts">
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui';
import { computed, onBeforeUnmount, ref } from 'vue';

import type { DeclarationChange } from '#shared/comparison/comparison.defs';
import DependencyComparisonLink from '~/components/comparison/DependencyComparisonLink.vue';
import RowViewport from '~/components/comparison/RowViewport.vue';

const props = defineProps<{ changes: readonly DeclarationChange<{ range: string }>[] }>();

const openGroup = ref<string | null>(null);

const groups = computed(() => [
  { kind: 'changed', label: 'updated', entries: props.changes.filter((change) => change.kind === 'changed') },
  { kind: 'removed', label: 'removed', entries: props.changes.filter((change) => change.kind === 'removed') },
  { kind: 'added', label: 'added', entries: props.changes.filter((change) => change.kind === 'added') },
]);

let closeTimer: ReturnType<typeof setTimeout> | undefined;

const cancelClose = () => {
  clearTimeout(closeTimer);
  closeTimer = undefined;
};

const showGroup = (kind: string) => {
  cancelClose();
  openGroup.value = kind;
};

const scheduleClose = () => {
  cancelClose();
  closeTimer = setTimeout(() => {
    openGroup.value = null;
    closeTimer = undefined;
  }, 150);
};

onBeforeUnmount(cancelClose);
</script>

<template>
  <div class="mb-4 rounded-[6px] bg-muted p-4.5 text-xs leading-[1.7] text-foreground">
    <template v-if="changes.length">
      <template v-for="(group, index) in groups" :key="group.kind">
        <span v-if="index > 0">, </span>
        <PopoverRoot
          v-if="group.entries.length"
          :open="openGroup === group.kind"
          @update:open="openGroup = $event ? group.kind : openGroup === group.kind ? null : openGroup"
        >
          <PopoverTrigger
            type="button"
            class="cursor-help underline decoration-dotted underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            @pointerenter="showGroup(group.kind)"
            @pointerleave="scheduleClose"
            @focus="showGroup(group.kind)"
          >
            {{
              `${group.entries.length}${index === 0 ? (group.entries.length === 1 ? ' dependency' : ' dependencies') : ''} ${group.label}`
            }}
          </PopoverTrigger>
          <PopoverPortal>
            <PopoverContent
              side="top"
              :side-offset="6"
              :collision-padding="12"
              :aria-label="`${group.label} dependencies`"
              @open-auto-focus.prevent
              @close-auto-focus.prevent
              @pointerenter="cancelClose"
              @pointerleave="scheduleClose"
              @focusin="cancelClose"
              class="z-50 max-w-[min(480px,calc(100vw-24px))] rounded-md border border-neutral-300 bg-neutral-100 px-3 py-2 font-body text-xs leading-relaxed text-neutral-900 shadow-lg"
            >
              <RowViewport :count="group.entries.length" rows="li" :label="`${group.label} dependencies`">
                <ul class="space-y-1">
                  <li v-for="change in group.entries" :key="change.name" class="wrap-anywhere">
                    <DependencyComparisonLink
                      v-if="group.kind === 'changed' && change.from && change.to"
                      :name="change.name"
                      :from="change.from.range"
                      :to="change.to.range"
                      @navigate="openGroup = null"
                    />
                    <template v-else>
                      <span class="font-medium">{{ change.name }}</span>
                      <span class="font-mono">{{
                        ` ${group.kind === 'removed' ? change.from?.range : change.to?.range}`
                      }}</span>
                    </template>
                  </li>
                </ul>
              </RowViewport>
            </PopoverContent>
          </PopoverPortal>
        </PopoverRoot>
        <span v-else> 0<template v-if="index === 0"> dependencies</template> {{ group.label }} </span>
      </template>
    </template>
    <template v-else>No dependency declaration changes</template>
  </div>
</template>
