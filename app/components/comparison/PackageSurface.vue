<script setup lang="ts">
import { ChevronDown } from '@lucide/vue';
import { computed } from 'vue';

import RowHelp from '~/components/comparison/RowHelp.vue';
import { usePackageMetadataQuery } from '~/composables/usePackageMetadataQuery';

import type { SurfaceComparison } from './packageSurface.defs';
import { hasBundledTypesEvidence, typesPackageName, withExternalTypes } from './packageSurfaceBadges';
import SurfaceDeclarations from './SurfaceDeclarations.vue';
import SurfaceLoadingBadges from './SurfaceLoadingBadges.vue';
import SurfaceVersionTree from './SurfaceVersionTree.vue';

const props = defineProps<{ surface: SurfaceComparison; open: boolean }>();

defineEmits<{ toggle: [] }>();

const root = computed(() => props.surface.entries.find((entry) => entry.key === '.'));

const externalTypesName = computed(() => {
  if (
    !import.meta.client ||
    [props.surface.from, props.surface.to].every((version) => hasBundledTypesEvidence(version.badges))
  )
    return null;

  return typesPackageName(root.value?.path ?? '');
});

const { data: externalTypesMetadata } = usePackageMetadataQuery(externalTypesName);

const versions = computed(() =>
  [props.surface.from, props.surface.to].map((version) => ({
    ...version,
    badges: withExternalTypes(
      version.badges,
      externalTypesMetadata.value?.name === externalTypesName.value ? externalTypesMetadata.value : null,
      version.version,
    ),
  })),
);
</script>

<template>
  <tr id="comparison-exports" class="scroll-mt-6">
    <th
      scope="row"
      class="border-b border-border/55 py-[15px] pr-4 pl-0 align-top font-normal wrap-anywhere max-[700px]:py-3.5 max-[700px]:pr-2"
    >
      <div class="flex items-start">
        <button
          type="button"
          :aria-expanded="open"
          aria-controls="details-comparison-exports"
          class="inline-flex cursor-pointer items-baseline gap-2 text-left [font:inherit] focus-visible:outline-2 focus-visible:outline-offset-[5px] focus-visible:outline-ring max-[700px]:underline max-[700px]:decoration-border max-[700px]:underline-offset-4"
          @click="$emit('toggle')"
        >
          Exports<ChevronDown
            :size="14"
            aria-hidden="true"
            class="shrink-0 self-center text-muted-foreground max-[700px]:hidden"
            :class="{ 'rotate-180': open }"
          />
        </button>
        <RowHelp
          label="Exports and loading"
          explanation="Badges describe declared package formats, not loading syntax: ESM is ES modules; CJS is CommonJS; TYPES is TypeScript declarations. A tick marks strong metadata evidence. A circled question mark marks a weaker indication that needs checking. A warning triangle means the latest external @types release is deprecated; check whether the compared version needs it. No badge means no indication was found, not that support is ruled out. Formats may belong to different paths. Missing export lists are not zero exports."
        />
      </div>
    </th>
    <td
      v-for="(version, index) in versions"
      :key="index"
      class="border-b border-border/55 px-4 py-[15px] align-top wrap-anywhere max-[700px]:px-2 max-[700px]:py-3.5"
    >
      <p :class="index === 0 ? 'text-muted-foreground' : 'font-medium'">
        {{
          version.exportCount === null
            ? 'Paths not listed'
            : `${version.exportCount} ${version.exportCount === 1 ? 'path' : 'paths'} exported`
        }}
      </p>
      <p v-if="version.patternCount" class="mt-1 text-[11px] text-muted-foreground">
        + {{ version.patternCount }} {{ version.patternCount === 1 ? 'path pattern' : 'path patterns' }}
      </p>
      <SurfaceLoadingBadges :badges="version.badges" class="mt-2" />
    </td>
  </tr>
  <tr id="details-comparison-exports" v-show="open">
    <td colspan="3" class="px-0 pt-4 pb-5">
      <div class="mb-3 flex flex-wrap items-start gap-x-3 text-xs text-muted-foreground">
        <p
          v-if="surface.summary.status === 'available'"
          class="flex flex-wrap gap-x-5 gap-y-1"
          aria-label="Export changes"
        >
          <span
            ><strong class="font-medium tabular-nums">{{ surface.summary.same }}</strong>
            {{ surface.summary.same === 1 ? 'export is' : 'exports are' }} the same</span
          >
          <span
            ><strong class="font-medium tabular-nums">{{ surface.summary.added }}</strong> new
            {{ surface.summary.added === 1 ? 'export' : 'exports' }}</span
          >
          <span
            ><strong class="font-medium tabular-nums">{{ surface.summary.removed }}</strong> removed
            {{ surface.summary.removed === 1 ? 'export' : 'exports' }}</span
          >
          <span
            ><strong class="font-medium tabular-nums">{{ surface.summary.changed }}</strong>
            {{ surface.summary.changed === 1 ? 'export' : 'exports' }} changed</span
          >
        </p>
        <p v-else>Change counts unavailable</p>
        <RowHelp
          label="Export changes"
          :explanation="
            surface.summary.status === 'available'
              ? 'Counts compare export declarations, including patterns, not verified APIs or files. Hover over, focus, or tap a path for loading examples and types.'
              : surface.summary.reason
          "
        />
      </div>
      <div class="grid grid-cols-2 items-start gap-5 max-[700px]:grid-cols-1">
        <SurfaceVersionTree :surface="surface" side="from" />
        <SurfaceVersionTree :surface="surface" side="to" />
      </div>
      <SurfaceDeclarations :versions="versions" />
    </td>
  </tr>
</template>
