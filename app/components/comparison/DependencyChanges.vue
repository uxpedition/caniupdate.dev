<script setup lang="ts">
import { computed, ref } from 'vue';

import type { DeclarationChange } from '#shared/comparison/comparison.defs';
import DependencyComparisonLink from '~/components/comparison/DependencyComparisonLink.vue';
import RowViewport from '~/components/comparison/RowViewport.vue';
import HoverPopover from '~/components/element/HoverPopover.vue';

const props = defineProps<{ changes: readonly DeclarationChange<{ range: string }>[] }>();

const openGroup = ref<string | null>(null);

const groups = computed(() => [
  { kind: 'changed', label: 'updated', entries: props.changes.filter((change) => change.kind === 'changed') },
  { kind: 'removed', label: 'removed', entries: props.changes.filter((change) => change.kind === 'removed') },
  { kind: 'added', label: 'added', entries: props.changes.filter((change) => change.kind === 'added') },
]);
</script>

<template>
  <div class="mb-4 rounded-[6px] bg-muted p-4.5 text-xs leading-[1.7] text-foreground">
    <template v-if="changes.length">
      <template v-for="(group, index) in groups" :key="group.kind">
        <span v-if="index > 0">, </span>
        <HoverPopover
          v-if="group.entries.length"
          :open="openGroup === group.kind"
          :label="`${group.label} dependencies`"
          @update:open="openGroup = $event ? group.kind : openGroup === group.kind ? null : openGroup"
        >
          <template #trigger>
            {{
              `${group.entries.length}${index === 0 ? (group.entries.length === 1 ? ' dependency' : ' dependencies') : ''} ${group.label}`
            }}
          </template>
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
        </HoverPopover>
        <span v-else> 0<template v-if="index === 0"> dependencies</template> {{ group.label }} </span>
      </template>
    </template>
    <template v-else>No dependency declaration changes</template>
  </div>
</template>
