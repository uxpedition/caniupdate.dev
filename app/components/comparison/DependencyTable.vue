<script setup lang="ts">
import { computed } from 'vue';

import type { DeclaredPackageVersion } from '#shared/comparison/comparison.defs';
import RowViewport from '~/components/comparison/RowViewport.vue';

const props = defineProps<{
  version: DeclaredPackageVersion;
  peers: boolean;
}>();

const entries = computed(() => {
  const requirements = props.peers
    ? props.version.peerDependencies
    : { ...props.version.dependencies, ...props.version.optionalDependencies };

  const optional = new Set(props.peers ? props.version.optionalPeers : Object.keys(props.version.optionalDependencies));

  return Object.entries(requirements)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, range]) => ({ name, range, optional: optional.has(name) }));
});
</script>

<template>
  <div class="min-w-0 overflow-hidden rounded-[6px] border border-border bg-background">
    <RowViewport
      :count="entries.length"
      rows=".dependency-row"
      :label="`${version.version} ${peers ? 'peer dependencies' : 'dependencies'}`"
    >
      <table class="w-full table-fixed border-collapse text-left text-xs leading-[1.6]">
        <caption class="sticky top-0 z-10 border-b border-border bg-muted px-3 py-3 text-left">
          <span class="flex flex-wrap items-baseline justify-between gap-2">
            <span class="font-mono wrap-anywhere">{{ version.version }}</span>
            <span class="text-foreground tabular-nums">
              {{ entries.length }} {{ entries.length === 1 ? 'dependency' : 'dependencies' }}
            </span>
          </span>
          <span class="sr-only">{{ peers ? 'Peer dependencies' : 'Runtime and optional dependencies' }}</span>
        </caption>
        <colgroup>
          <col class="w-2/5" />
          <col />
          <col class="w-16" />
        </colgroup>
        <thead class="sr-only">
          <tr>
            <th scope="col">Package</th>
            <th scope="col">Version range</th>
            <th scope="col">Optional</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="entry in entries" :key="entry.name" class="dependency-row border-b border-border last:border-b-0">
            <th scope="row" class="px-3 py-3 align-top font-normal wrap-anywhere">{{ entry.name }}</th>
            <td class="px-3 py-3 align-top font-mono wrap-anywhere">{{ entry.range }}</td>
            <td class="py-3 pr-3 align-top text-right">
              <span
                v-if="entry.optional"
                class="inline-block rounded-xs bg-neutral-600 px-1.5 py-0.5 text-[10px] text-white"
              >
                Optional
              </span>
            </td>
          </tr>
          <tr v-if="entries.length === 0">
            <td colspan="3" class="px-3 py-3 text-muted-foreground">None declared</td>
          </tr>
        </tbody>
      </table>
    </RowViewport>
  </div>
</template>
