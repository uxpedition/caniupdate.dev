<script setup lang="ts">
import { ArrowUpRight } from '@lucide/vue';

import type { PackageVulnerabilities } from '#shared/comparison/evidence/osv.defs';
import RowViewport from '~/components/comparison/RowViewport.vue';

defineProps<{
  version: string;
  vulnerabilities: PackageVulnerabilities;
}>();
</script>

<template>
  <div class="min-w-0 overflow-hidden rounded-[6px] border border-border bg-background">
    <RowViewport
      :count="vulnerabilities.advisories.length"
      rows=".advisory-row"
      :label="`${version} security advisories`"
    >
      <table class="w-full table-fixed border-collapse text-left text-xs leading-[1.6]">
        <caption class="sticky top-0 z-10 border-b border-border bg-muted px-3 py-3 text-left">
          <span class="flex flex-wrap items-baseline justify-between gap-2">
            <span class="font-mono wrap-anywhere">{{ version }}</span>
            <span class="text-foreground tabular-nums">
              {{ vulnerabilities.count === null ? 'Count unavailable' : `${vulnerabilities.count} matched` }}
            </span>
          </span>
          <span class="mt-1 block text-muted-foreground">
            <template v-if="vulnerabilities.status === 'available'">Coverage available</template>
            <template v-else-if="vulnerabilities.status === 'partial'"
              >Partial coverage · list may be incomplete</template
            >
            <template v-else>Coverage unavailable · matches cannot be determined</template>
          </span>
          <span class="sr-only">Security advisories</span>
        </caption>
        <colgroup>
          <col class="w-2/5" />
          <col />
        </colgroup>
        <thead class="sr-only">
          <tr>
            <th scope="col">Advisory</th>
            <th scope="col">Summary</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="advisory in vulnerabilities.advisories"
            :key="advisory.id"
            class="advisory-row border-b border-border last:border-b-0"
          >
            <th scope="row" class="px-3 py-3 align-top font-normal wrap-anywhere">
              <a
                :href="`https://osv.dev/vulnerability/${encodeURIComponent(advisory.id)}`"
                target="_blank"
                rel="noreferrer"
                class="underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {{ advisory.id }}
                <ArrowUpRight :size="12" class="inline-block" aria-hidden="true" />
                <span class="sr-only"> (OSV advisory, opens in a new tab)</span>
              </a>
            </th>
            <td class="px-3 py-3 align-top wrap-anywhere">
              <template v-if="advisory.detailsStatus === 'unavailable'">Details unavailable</template>
              <template v-else>{{ advisory.summary || 'Summary unavailable' }}</template>
            </td>
          </tr>
          <tr v-if="vulnerabilities.advisories.length === 0">
            <td colspan="2" class="px-3 py-3 text-muted-foreground">
              {{
                vulnerabilities.status === 'available' ? 'No known advisories matched' : 'No advisory records available'
              }}
            </td>
          </tr>
        </tbody>
      </table>
    </RowViewport>
  </div>
</template>
