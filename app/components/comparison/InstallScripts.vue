<script setup lang="ts">
import { ChevronDown } from '@lucide/vue';
import { Array as EffectArray, Match, Record } from 'effect';
import { computed } from 'vue';

import type { PackageDeclarationsResponse, PackageMeasurementsResponse } from '#shared/comparison/comparison.defs';
import RowHelp from '~/components/comparison/RowHelp.vue';

import { installActionLabels, matchingInstallMeasurements } from './installScripts';
import InstallScriptVersion from './InstallScriptVersion.vue';

const props = defineProps<{
  declarations: PackageDeclarationsResponse;
  measurements: PackageMeasurementsResponse | undefined;
  unavailable: boolean;
  open: boolean;
}>();

defineEmits<{ toggle: [] }>();

const measured = computed(() => matchingInstallMeasurements(props.declarations, props.measurements));

const versions = computed(() =>
  EffectArray.map(
    [
      { declared: props.declarations.from, analysis: measured.value?.from.installAnalysis },
      { declared: props.declarations.to, analysis: measured.value?.to.installAnalysis },
    ],
    (version) => {
      const count = Record.size(version.declared.installScriptCommands);

      return {
        ...version,
        commandLabel: count ? `${count} install ${count === 1 ? 'script' : 'scripts'}` : 'None declared',
        implicit: EffectArray.some(version.analysis?.scripts ?? [], (script) => script.origin === 'implicit'),
        coverage: Match.value(version.analysis?.status).pipe(
          Match.when('partial', () => 'Code partly checked'),
          Match.when('unavailable', () => 'Code check unavailable'),
          Match.orElse(() => (props.unavailable ? 'Code check unavailable' : 'Checking code…')),
        ),
      };
    },
  ),
);

const commandChanges = computed(() => {
  const changes = props.declarations.comparison.installScripts;

  return EffectArray.reduce(changes, { added: 0, removed: 0, changed: 0, total: changes.length }, (counts, change) => {
    counts[change.kind]++;

    return counts;
  });
});

const implementation = computed(() => measured.value?.comparison.installImplementation);

const actions = computed(() =>
  EffectArray.map(versions.value, ({ analysis }) =>
    EffectArray.join(
      EffectArray.map(
        EffectArray.dedupe(EffectArray.map(analysis?.findings ?? [], ({ kind }) => kind)),
        (kind) => installActionLabels[kind],
      ),
      ' · ',
    ),
  ),
);
</script>

<template>
  <tr id="comparison-install-scripts" class="scroll-mt-6">
    <th
      scope="row"
      class="border-b border-border/55 py-[15px] pr-4 pl-0 align-top font-normal wrap-anywhere max-[700px]:py-3.5 max-[700px]:pr-2"
    >
      <div class="flex items-start">
        <button
          type="button"
          :aria-expanded="open"
          aria-controls="details-comparison-install-scripts"
          class="inline-flex cursor-pointer items-baseline gap-2 text-left [font:inherit] focus-visible:outline-2 focus-visible:outline-offset-[5px] focus-visible:outline-ring max-[700px]:underline max-[700px]:decoration-border max-[700px]:underline-offset-4"
          @click="$emit('toggle')"
        >
          Install scripts<ChevronDown
            :size="14"
            aria-hidden="true"
            class="shrink-0 self-center text-muted-foreground max-[700px]:hidden"
            :class="{ 'rotate-180': open }"
          />
        </button>
        <RowHelp
          label="Install scripts"
          explanation="Code that may run during installation. Files are read, not executed. Findings are not a security assessment."
        />
      </div>
    </th>
    <td
      v-for="(version, index) in versions"
      :key="index"
      class="border-b border-border/55 px-4 py-[15px] align-top wrap-anywhere max-[700px]:px-2 max-[700px]:py-3.5"
    >
      <p :class="index === 0 ? 'text-muted-foreground' : 'font-medium'">
        {{ version.commandLabel }}
      </p>
      <p v-if="version.implicit" class="mt-1 text-[11px] text-muted-foreground">npm may build native code</p>
      <p v-if="actions[index]?.length" class="mt-2 text-[11px] leading-[1.7] text-muted-foreground">
        {{ actions[index] }}
      </p>
      <p v-if="version.analysis?.status !== 'available'" class="mt-1 text-[11px] text-muted-foreground">
        {{ version.coverage }}
      </p>
    </td>
  </tr>
  <tr id="details-comparison-install-scripts" v-show="open">
    <td colspan="3" class="px-0 pt-4 pb-5">
      <div class="mb-4 rounded-[6px] bg-muted p-4.5 text-xs leading-[1.7]">
        <p v-if="commandChanges.total" class="flex flex-wrap gap-x-3 gap-y-1">
          <span>Install commands:</span>
          <span v-if="commandChanges.added">{{ commandChanges.added }} added</span>
          <span v-if="commandChanges.removed">{{ commandChanges.removed }} removed</span>
          <span v-if="commandChanges.changed">{{ commandChanges.changed }} changed</span>
        </p>
        <p v-else>Declared install commands unchanged.</p>
        <p v-if="implementation?.changedFiles.length" class="mt-2">
          {{
            commandChanges.total
              ? 'Files used by the install code changed:'
              : 'The commands stayed the same, but files they use changed:'
          }}
          <span class="font-mono wrap-anywhere">{{ EffectArray.join(implementation.changedFiles, ', ') }}</span
          >.
        </p>
        <p v-else-if="implementation?.status === 'available'" class="mt-2 text-muted-foreground">
          No content changes found in files followed in both versions.
        </p>
        <p v-if="implementation && implementation.status !== 'available'" class="mt-2 text-muted-foreground">
          Code comparison incomplete. Some calls may be missing.
        </p>
      </div>
      <div class="grid grid-cols-2 items-start gap-5 max-[700px]:grid-cols-1">
        <InstallScriptVersion
          v-for="(version, index) in versions"
          :key="index"
          :version="version.declared"
          :analysis="version.analysis"
          :unavailable="unavailable"
          :changes="declarations.comparison.installScripts"
        />
      </div>
      <p class="mt-5 text-xs leading-[1.7] text-muted-foreground">
        Listed calls may never run. Checks cover published package files only—not dependencies, downloads, compiled
        programs, or Git and local installs.
      </p>
    </td>
  </tr>
</template>
