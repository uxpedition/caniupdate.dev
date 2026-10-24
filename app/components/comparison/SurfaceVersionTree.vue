<script setup lang="ts">
import { computed } from 'vue';

import RowViewport from '~/components/comparison/RowViewport.vue';

import type { SurfaceComparison, SurfaceEntry } from './packageSurface.defs';
import SurfacePathPreview from './SurfacePathPreview.vue';

const props = defineProps<{ surface: SurfaceComparison; side: 'from' | 'to' }>();

const version = computed(() => props.surface[props.side]);

function changeLabel(entry: SurfaceEntry, before: ReadonlySet<string>, after: ReadonlySet<string>): string {
  if (before.has(entry.key) && after.has(entry.key)) {
    return entry.from.signature === entry.to.signature ? '' : 'Changed';
  }

  if (props.side === 'to' && after.has(entry.key)) return 'New';

  if (props.side === 'from' && before.has(entry.key)) return 'Removed';

  return '';
}

const nodes = computed(() => {
  const current = version.value;

  if (current.declaredKeys.length === 0 && current.exportCount === 0) return [];
  const declared = new Set(current.declaredKeys);
  const visible = new Set(['.', ...declared]);
  const before = new Set(props.surface.from.exportKeys);
  const after = new Set(props.surface.to.exportKeys);

  for (const key of declared) {
    const parts = key.split('/');

    for (let index = 1; index < parts.length; index += 1) visible.add(parts.slice(0, index).join('/'));
  }

  const entries = props.surface.entries.filter((entry) => visible.has(entry.key));
  const lastChildren = new Map<string, string>();

  for (const entry of entries) {
    if (entry.depth) lastChildren.set(entry.key.slice(0, entry.key.lastIndexOf('/')), entry.key);
  }

  return entries.map((entry) => {
    const group = !declared.has(entry.key) && !(entry.key === '.' && current.declaredKeys.length === 0);
    const change = props.surface.summary.status === 'available' ? changeLabel(entry, before, after) : '';

    const parts = entry.key.split('/');

    const branches = parts.slice(1).map((_, index) => ({
      level: index + 1,
      last: lastChildren.get(parts.slice(0, index + 1).join('/')) === parts.slice(0, index + 2).join('/'),
    }));

    return { entry, group, change, branches, hasChildren: lastChildren.has(entry.key) };
  });
});
</script>

<template>
  <div class="min-w-0 overflow-hidden rounded-[6px] border border-border bg-background" :data-surface-version="side">
    <RowViewport :count="nodes.length" rows=".surface-path" :label="`Import paths for ${version.version}`">
      <h3
        class="sticky top-0 z-10 flex flex-wrap items-baseline justify-between gap-2 border-b border-border bg-muted px-3 py-3 text-xs leading-relaxed font-normal"
      >
        <span class="font-mono">{{ version.version }}</span>
        <span
          >{{
            version.exportCount === null
              ? 'Paths not listed'
              : `${version.exportCount} ${version.exportCount === 1 ? 'path' : 'paths'} exported`
          }}<template v-if="version.patternCount">
            · {{ version.patternCount }} {{ version.patternCount === 1 ? 'pattern' : 'patterns' }}</template
          ></span
        >
      </h3>
      <ul v-if="nodes.length" :aria-label="`Import paths for ${version.version}`">
        <li v-for="node in nodes" :key="node.entry.key" class="surface-path relative px-3 py-3 text-xs leading-relaxed">
          <span
            v-for="branch in node.branches"
            :key="branch.level"
            aria-hidden="true"
            class="pointer-events-none absolute top-0 bottom-0 w-3"
            :style="{ insetInlineStart: `${20 + (branch.level - 1) * 20}px` }"
          >
            <span
              v-if="!branch.last || branch.level === node.entry.depth"
              class="absolute top-0 border-l border-muted-foreground/45"
              :class="branch.last ? 'h-1/2' : 'h-full'"
            />
            <span
              v-if="branch.level === node.entry.depth"
              class="absolute top-1/2 w-3 border-t border-muted-foreground/45"
            />
          </span>
          <span
            v-if="node.hasChildren"
            aria-hidden="true"
            class="pointer-events-none absolute top-[calc(50%+10px)] bottom-0 border-l border-muted-foreground/45"
            :style="{ insetInlineStart: `${20 + node.entry.depth * 20}px` }"
          />
          <div class="flex items-baseline gap-2" :style="{ paddingInlineStart: `${node.entry.depth * 20}px` }">
            <span v-if="node.group" class="font-mono text-muted-foreground wrap-anywhere"
              >{{ node.entry.path }}/ <span class="font-body text-[10px]">folder</span></span
            >
            <SurfacePathPreview v-else :entry="node.entry" :side="side" :version="version.version" />
            <span v-if="node.change" class="ml-auto shrink-0 text-[10px] text-change">{{ node.change }}</span>
            <span
              v-else-if="node.entry[side].label === 'Blocked'"
              class="ml-auto shrink-0 text-[10px] text-muted-foreground"
              >Blocked</span
            >
          </div>
        </li>
      </ul>
      <p v-else class="px-3 py-3 text-xs text-muted-foreground">No exported paths declared.</p>
    </RowViewport>
    <p
      v-if="version.exportCount === null"
      class="border-t border-border px-3 py-3 text-xs leading-relaxed text-muted-foreground"
    >
      The export list is absent or incomplete. The package entry is shown where known; other import paths may still
      work.
    </p>
  </div>
</template>
