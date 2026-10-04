<script setup lang="ts">
import { ChevronDown, LoaderCircle, Minus, Plus } from '@lucide/vue';
import { computed, nextTick, ref } from 'vue';

import BriefingPanel from '~/components/comparison/BriefingPanel.vue';
import EvidencePanel from '~/components/comparison/EvidencePanel.vue';
import RowHelp from '~/components/comparison/RowHelp.vue';
import LoadingMessage from '~/components/element/LoadingMessage.vue';
import { useComparisonPage } from '~/composables/useComparisonPage';
import { buildComparisonSummaries, sizeChange } from '~/pages/[packageName]/comparisonSummary';
import { buildComparisonRows, MEASURING_VALUE } from '~/pages/[packageName]/comparisonView';

const {
  packageName,
  displayFromVersion,
  displayToVersion,
  declarations,
  measurements,
  isDeclarationsError,
  isMeasurementsPending,
  isMeasurementsUnavailable,
  briefing,
  isBriefingPending,
  briefingStatus,
  briefingError,
  sources,
} = await useComparisonPage();
const expanded = ref(new Set<string>());
const showBrief = ref(false);
const showSources = ref(false);
// Render here so the description arrives in the same SSR branch as the declaration rows, before hydration.
const description = computed(() => declarations.value?.to.description ?? declarations.value?.from.description);
const rows = computed(() =>
  declarations.value
    ? buildComparisonSummaries(
        {
          declarations: declarations.value,
          measurements: measurements.value,
          measurementsUnavailable: isMeasurementsUnavailable.value,
        },
        buildComparisonRows(declarations.value, measurements.value, isMeasurementsUnavailable.value),
      )
    : [],
);
const groups = computed(() => [
  { title: 'Dependencies & runtime', rows: rows.value.slice(0, 3) },
  { title: 'Package surface', rows: rows.value.slice(3, 8) },
  { title: 'Size & provenance', rows: rows.value.slice(8) },
]);
const changedCount = computed(() => rows.value.filter((row) => row.changed).length);
const dependencyCount = computed(() => declarations.value?.comparison.dependencies.length ?? 0);
const security = computed(() => {
  const measured = measurements.value;
  if (!measured) return { value: isMeasurementsUnavailable.value ? 'Unavailable' : 'Checking…', detail: '' };
  const { status, count } = measured.to.vulnerabilities;
  if (status !== 'available' || count === null)
    return { value: 'Incomplete coverage', detail: 'No safety conclusion can be drawn.' };
  return {
    value: `${count} matched ${count === 1 ? 'advisory' : 'advisories'}`,
    detail: `For ${measured.to.version} · not a guarantee of safety`,
  };
});
const briefingState = computed(() => {
  if (isDeclarationsError.value) return 'Waiting for package facts';
  if (briefingError.value || briefing.value?.status === 'unavailable') return 'Unavailable · facts are unaffected';
  if (briefing.value?.status === 'available') return `${briefing.value.bullets.length} evidence-linked notes`;
  return 'Preparing evidence-linked notes…';
});

const toggleRow = (id: string) => {
  if (expanded.value.has(id)) expanded.value.delete(id);
  else expanded.value.add(id);
};
const preventBriefingToggle = (event: MouseEvent) => {
  if (isBriefingPending.value) event.preventDefault();
};
const revealCitation = async (event: MouseEvent) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const href = target.closest('a')?.getAttribute('href');
  if (!href?.startsWith('#')) return;
  const id = href.slice(1);
  const row = rows.value.find((item) => item.anchor === id);
  if (row?.expandable) expanded.value.add(row.anchor);
  if (id.startsWith('evidence-')) showSources.value = true;
  await nextTick();
  document.getElementById(id)?.scrollIntoView({ block: 'center' });
};
</script>

<template>
  <div @click="revealCitation">
    <div
      v-if="isDeclarationsError"
      data-comparison-ready
      class="mt-11 py-[30px] text-sm leading-[1.8] text-destructive max-[700px]:mt-8"
      role="alert"
    >
      <h2 class="text-base font-semibold tracking-[-0.02em]">This comparison couldn’t be loaded.</h2>
      <p>
        Check the package and versions, then
        <NuxtLink
          to="/"
          class="underline hover:underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-[5px] focus-visible:outline-ring"
          >try again from package search</NuxtLink
        >.
      </p>
    </div>
    <template v-else-if="declarations">
      <p v-if="description" class="mt-4 text-sm leading-[1.6] text-muted-foreground">{{ description }}</p>
      <section data-comparison-ready aria-labelledby="overview-heading" class="mt-11 max-[700px]:mt-8">
        <h2 id="overview-heading" class="text-base font-semibold tracking-[-0.02em]">At a glance</h2>
        <p v-if="declarations.comparison.node.changed" class="mt-4 text-sm leading-[1.7]">
          Node requirement changed:
          <code class="font-mono text-change">{{ declarations.from.engines.node ?? 'Not declared' }}</code> →
          <code class="font-mono text-change">{{ declarations.to.engines.node ?? 'Not declared' }}</code
          >.
        </p>
        <div class="mt-5.5 grid grid-cols-3 gap-8 max-[700px]:grid-cols-1 max-[700px]:gap-5">
          <a
            href="#comparison-dependencies"
            class="group flex min-w-0 flex-col items-start gap-[7px] hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-[5px] focus-visible:outline-ring max-[700px]:grid max-[700px]:grid-cols-[110px_minmax(0,1fr)] max-[700px]:items-baseline max-[700px]:gap-x-3 max-[700px]:gap-y-1"
          >
            <span class="text-xs leading-normal text-muted-foreground">Dependencies</span>
            <strong
              class="text-[19px] leading-[1.4] font-[550] tracking-[-0.03em] tabular-nums max-[700px]:text-base group-hover:underline group-hover:underline-offset-4"
              >{{ dependencyCount === 0 ? 'No declaration changes' : `${dependencyCount} declaration changes` }}</strong
            >
            <span class="text-[11px] leading-[1.6] text-muted-foreground max-[700px]:col-start-2"
              >Runtime and optional dependencies</span
            >
          </a>
          <a
            href="#comparison-sizes-gzip"
            class="group flex min-w-0 flex-col items-start gap-[7px] hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-[5px] focus-visible:outline-ring max-[700px]:grid max-[700px]:grid-cols-[110px_minmax(0,1fr)] max-[700px]:items-baseline max-[700px]:gap-x-3 max-[700px]:gap-y-1"
          >
            <span class="text-xs leading-normal text-muted-foreground">Gzip estimate</span>
            <strong
              class="text-[19px] leading-[1.4] font-[550] tracking-[-0.03em] tabular-nums max-[700px]:text-base group-hover:underline group-hover:underline-offset-4"
              :class="{
                'text-change':
                  measurements !== undefined &&
                  measurements.comparison.sizes.bundle.gzip.delta !== null &&
                  measurements.comparison.sizes.bundle.gzip.delta !== 0,
              }"
              ><LoadingMessage
                v-if="isMeasurementsPending"
                as="span"
                class="inline-flex text-[19px] text-foreground"
                loading-text="Measuring…"
              /><template v-else>{{
                measurements === undefined ? 'Unavailable' : sizeChange(measurements.comparison.sizes.bundle.gzip)
              }}</template></strong
            >
            <span class="text-[11px] leading-[1.6] text-muted-foreground max-[700px]:col-start-2"
              >Bundlephobia estimate, not your app bundle</span
            >
          </a>
          <a
            href="#comparison-advisories"
            class="group flex min-w-0 flex-col items-start gap-[7px] hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-[5px] focus-visible:outline-ring max-[700px]:grid max-[700px]:grid-cols-[110px_minmax(0,1fr)] max-[700px]:items-baseline max-[700px]:gap-x-3 max-[700px]:gap-y-1"
          >
            <span class="text-xs leading-normal text-muted-foreground">Security</span>
            <strong
              class="text-[19px] leading-[1.4] font-[550] tracking-[-0.03em] tabular-nums max-[700px]:text-base group-hover:underline group-hover:underline-offset-4"
              :class="{ 'text-destructive': (measurements?.to.vulnerabilities.count ?? 0) > 0 }"
              ><LoadingMessage
                v-if="isMeasurementsPending && !isMeasurementsUnavailable"
                as="span"
                class="inline-flex text-[19px] text-foreground"
                loading-text="Checking…"
              /><template v-else>{{ security.value }}</template></strong
            >
            <span class="text-[11px] leading-[1.6] text-muted-foreground max-[700px]:col-start-2">{{
              security.detail
            }}</span>
          </a>
        </div>
      </section>

      <details
        class="mt-8 rounded-[6px] bg-muted px-4.5 py-3.5 max-[700px]:p-3.5"
        :inert="isBriefingPending"
        :open="showBrief && !isBriefingPending"
        @toggle="showBrief = !isBriefingPending && ($event.target as HTMLDetailsElement).open"
      >
        <summary
          :aria-disabled="isBriefingPending"
          :class="[
            'flex list-none flex-wrap items-baseline gap-x-4.5 gap-y-2 text-[13px] leading-normal focus-visible:outline-2 focus-visible:outline-offset-[5px] focus-visible:outline-ring [&::-webkit-details-marker]:hidden',
            isBriefingPending ? 'cursor-not-allowed' : 'cursor-pointer',
          ]"
          @click="preventBriefingToggle"
        >
          <span aria-hidden="true" class="inline-flex shrink-0 self-center text-muted-foreground">
            <LoaderCircle
              v-if="isBriefingPending"
              aria-hidden="true"
              :size="16"
              class="shrink-0 motion-safe:animate-spin"
            />
            <Minus v-else-if="showBrief" :size="14" />
            <Plus v-else :size="14" />
          </span>
          <span>AI migration notes</span
          ><span class="ml-auto text-xs leading-normal text-muted-foreground max-[700px]:ml-6">{{
            briefingState
          }}</span>
        </summary>
        <BriefingPanel
          :briefing="briefing"
          :pending="isBriefingPending"
          :status="briefingStatus"
          :error="briefingError"
        />
      </details>

      <section class="mt-11" aria-labelledby="comparison-heading">
        <div class="mb-5 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="comparison-heading" class="text-base font-semibold tracking-[-0.02em]">Compare releases</h2>
          <LoadingMessage
            v-if="isMeasurementsPending && !isMeasurementsUnavailable"
            as="p"
            class="text-xs"
            loading-text="Measuring remaining categories…"
          />
          <p v-else class="text-xs leading-normal text-muted-foreground">
            {{
              isMeasurementsUnavailable
                ? 'Measurement categories unavailable'
                : `${changedCount} of ${rows.length} categories changed`
            }}
          </p>
        </div>
        <div
          class="overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-[5px] focus-visible:outline-ring"
          tabindex="0"
          role="region"
          aria-label="Release comparison table"
        >
          <table
            class="w-full table-fixed border-collapse text-left text-sm leading-normal max-[700px]:text-xs max-[700px]:leading-normal"
          >
            <caption class="sr-only">
              Package declarations for
              {{
                packageName
              }},
              {{
                displayFromVersion
              }}
              compared with
              {{
                displayToVersion
              }}. Expand category names for full evidence.
            </caption>
            <colgroup>
              <col class="w-[38%] max-[700px]:w-[36%]" />
              <col />
              <col />
            </colgroup>
            <thead>
              <tr>
                <th
                  scope="col"
                  class="border-b border-border pt-0 pr-4 pb-5 pl-0 align-bottom font-body text-xs leading-[normal] font-normal text-muted-foreground wrap-anywhere max-[700px]:pr-2"
                >
                  Package facts
                </th>
                <th
                  scope="col"
                  class="border-b border-border px-4 pt-0 pb-5 align-bottom font-mono text-sm leading-[1.6] font-medium wrap-anywhere max-[700px]:px-2 max-[700px]:text-xs"
                >
                  <span class="mb-[5px] block font-body text-[11px] leading-[normal] font-normal text-muted-foreground"
                    >Current</span
                  ><span>{{ displayFromVersion }}</span>
                </th>
                <th
                  scope="col"
                  class="border-b border-border px-4 pt-0 pb-5 align-bottom font-mono text-sm leading-[1.6] font-medium wrap-anywhere max-[700px]:px-2 max-[700px]:text-xs"
                >
                  <span class="mb-[5px] block font-body text-[11px] leading-[normal] font-normal text-muted-foreground"
                    >Updating to</span
                  ><span>{{ displayToVersion }}</span>
                </th>
              </tr>
            </thead>
            <tbody v-for="group in groups" :key="group.title">
              <tr>
                <th
                  colspan="3"
                  scope="rowgroup"
                  class="px-0 pt-[30px] pb-3 text-[11px] leading-normal font-medium tracking-[0.04em] text-muted-foreground"
                >
                  {{ group.title }}
                </th>
              </tr>
              <template v-for="item in group.rows" :key="item.anchor">
                <tr :id="item.anchor" class="scroll-mt-6">
                  <th
                    scope="row"
                    class="border-b border-b-border/55 py-[15px] pr-4 pl-0 align-top font-normal wrap-anywhere max-[700px]:py-3.5 max-[700px]:pr-2"
                  >
                    <div class="flex items-start">
                      <button
                        v-if="item.expandable"
                        type="button"
                        :aria-expanded="expanded.has(item.anchor)"
                        :aria-controls="`details-${item.anchor}`"
                        class="inline-flex cursor-pointer items-baseline gap-2 text-left [font:inherit] text-inherit focus-visible:outline-2 focus-visible:outline-offset-[5px] focus-visible:outline-ring max-[700px]:underline max-[700px]:decoration-border max-[700px]:underline-offset-4"
                        @click="toggleRow(item.anchor)"
                      >
                        {{ item.row.label
                        }}<span
                          aria-hidden="true"
                          class="inline-flex shrink-0 self-center text-muted-foreground transition-transform duration-150 motion-reduce:transition-none max-[700px]:hidden"
                          :class="{ 'rotate-180': expanded.has(item.anchor) }"
                        >
                          <ChevronDown :size="14" />
                        </span>
                      </button>
                      <span v-else>{{ item.row.label }}</span>
                      <RowHelp :label="item.row.label" :explanation="item.row.explanation" />
                    </div>
                  </th>
                  <td
                    class="border-b border-b-border/55 px-4 py-[15px] align-top text-muted-foreground wrap-anywhere max-[700px]:px-2 max-[700px]:py-3.5"
                  >
                    <LoadingMessage
                      v-if="item.from === MEASURING_VALUE"
                      as="span"
                      class="inline-flex"
                      loading-text="Measuring…"
                    />
                    <template v-else>{{ item.from }}</template>
                    <span v-if="item.fromNote" class="mt-[5px] block text-[11px] leading-[1.6] text-muted-foreground">{{
                      item.fromNote
                    }}</span>
                  </td>
                  <td
                    class="border-b border-b-border/55 px-4 py-[15px] align-top wrap-anywhere max-[700px]:px-2 max-[700px]:py-3.5"
                  >
                    <span class="font-medium" :class="{ 'text-change': item.changed }"
                      ><LoadingMessage
                        v-if="item.from === MEASURING_VALUE"
                        as="span"
                        class="inline-flex text-foreground"
                        loading-text="Measuring…"
                      /><template v-else>{{ item.to }}</template></span
                    ><span v-if="item.toNote" class="mt-[5px] block text-[11px] leading-[1.6] text-muted-foreground">{{
                      item.toNote
                    }}</span
                    ><span
                      v-if="item.note && item.showNote"
                      class="mt-[5px] block text-[11px] leading-[1.6] text-muted-foreground"
                      >{{ item.note }}</span
                    >
                  </td>
                </tr>
                <tr v-if="item.expandable" v-show="expanded.has(item.anchor)" :id="`details-${item.anchor}`">
                  <td colspan="3" class="bg-muted p-4.5">
                    <div
                      class="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-7 max-[700px]:grid-cols-[minmax(0,1fr)] max-[700px]:gap-5"
                    >
                      <div>
                        <h3 class="mb-3 font-mono text-xs leading-[normal] text-muted-foreground">
                          {{ displayFromVersion }}
                        </h3>
                        <pre
                          class="max-h-104 overflow-auto font-mono text-xs leading-[1.8] whitespace-pre-wrap wrap-anywhere"
                          >{{ item.row.from }}</pre>
                      </div>
                      <div>
                        <h3 class="mb-3 font-mono text-xs leading-[normal] text-muted-foreground">
                          {{ displayToVersion }}
                        </h3>
                        <pre
                          class="max-h-104 overflow-auto font-mono text-xs leading-[1.8] whitespace-pre-wrap wrap-anywhere"
                          >{{ item.row.to }}</pre>
                      </div>
                    </div>
                    <p v-if="item.row.detail" class="mt-4 text-xs leading-[1.7] text-muted-foreground">
                      {{ item.row.detail }}
                    </p>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
        <p class="mt-4 text-xs leading-[1.7] text-muted-foreground">
          Blue values indicate a change, not a risk rating. Expand a category for complete declarations and measurement
          notes.
        </p>
      </section>

      <details
        v-if="sources.length"
        class="mt-9 border-t border-border pt-5.5"
        :open="showSources"
        @toggle="showSources = ($event.target as HTMLDetailsElement).open"
      >
        <summary
          class="flex cursor-pointer list-none flex-wrap items-baseline gap-x-4.5 gap-y-2 text-[13px] leading-normal focus-visible:outline-2 focus-visible:outline-offset-[5px] focus-visible:outline-ring [&::-webkit-details-marker]:hidden"
        >
          <span aria-hidden="true" class="inline-flex shrink-0 self-center text-muted-foreground">
            <Minus v-if="showSources" :size="14" />
            <Plus v-else :size="14" />
          </span>
          <span>Sources & evidence</span
          ><span class="ml-auto text-xs leading-normal text-muted-foreground max-[700px]:ml-6"
            >{{ sources.length }} sources</span
          >
        </summary>
        <EvidencePanel :sources="sources" />
      </details>
      <footer class="mt-8 text-[11px] leading-[1.7] text-muted-foreground">
        Published declarations, not a compatibility guarantee. Test the update in your application.
      </footer>
    </template>
  </div>
</template>
