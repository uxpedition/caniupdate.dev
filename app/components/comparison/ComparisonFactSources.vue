<script setup lang="ts">
import { computed } from 'vue';

import type { PackageDeclarationsResponse, PackageMeasurementsResponse } from '#shared/comparison/comparison.defs';

const props = defineProps<{
  declarations: PackageDeclarationsResponse;
  measurements: PackageMeasurementsResponse | undefined;
}>();

const versions = computed(() =>
  (['from', 'to'] as const).map((side) => {
    const version = props.declarations[side].version;
    const measured = props.measurements?.[side];

    return {
      side,
      label: side === 'from' ? 'Before' : 'After',
      version,
      versionUrl: `https://npmx.dev/package/${props.declarations.packageName.split('/').map(encodeURIComponent).join('/')}/v/${encodeURIComponent(version)}`,
      bundle: measured?.bundleSize,
      advisories: measured?.vulnerabilities.advisories ?? [],
    };
  }),
);
</script>

<template>
  <details class="mt-5 text-xs leading-[1.7] text-muted-foreground">
    <summary
      class="cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-[5px] focus-visible:outline-ring"
    >
      Fact sources & collection times
    </summary>
    <ul class="mt-3 space-y-3 pl-4">
      <li v-for="item in versions" :key="item.side" class="wrap-anywhere">
        <span>{{ item.label }} {{ item.version }}: </span>
        <a :href="item.versionUrl" target="_blank" rel="noreferrer" class="underline underline-offset-4"
          >Package version on npmx.dev</a
        >.
        <template v-if="item.bundle?.status === 'available'">
          <a :href="item.bundle.url" target="_blank" rel="noreferrer" class="underline underline-offset-4"
            >Bundlephobia estimate</a
          >, collected <time :datetime="item.bundle.retrievedAt">{{ item.bundle.retrievedAt }}</time
          >.
        </template>
        <template v-for="advisory in item.advisories" :key="advisory.id">
          <a :href="advisory.url" target="_blank" rel="noreferrer" class="underline underline-offset-4">{{
            advisory.id
          }}</a>
          (OSV match).
        </template>
      </li>
    </ul>
    <p class="mt-3">
      Advisory counts are matches reported by
      <a href="https://osv.dev/" target="_blank" rel="noreferrer" class="underline underline-offset-4">OSV</a>, not a
      security audit. Collection times are shown only where supplied; advisory modification dates are not collection
      times. Maintainer statements and AI interpretations appear separately in AI notes and their evidence.
    </p>
  </details>
</template>
