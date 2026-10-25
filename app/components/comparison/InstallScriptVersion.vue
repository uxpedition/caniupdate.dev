<script setup lang="ts">
// Vue's generated array-prop validators need the native Array constructor.
import { Array as EffectArray, Match, Option, Order, Record, Result } from 'effect';
import { computed } from 'vue';

import type { DeclaredPackageVersion, DeclarationChange } from '#shared/comparison/comparison.defs';
import type { InstallAnalysis } from '#shared/comparison/evidence/installScripts.defs';

import { installActionLabels, installSourceLink } from './installScripts';

const props = defineProps<{
  version: DeclaredPackageVersion;
  analysis: InstallAnalysis | undefined;
  unavailable: boolean;
  changes: readonly DeclarationChange<string>[];
}>();

const hookOrder = ['preinstall', 'install', 'postinstall'];

const commands = computed(() => {
  const declared = EffectArray.map(Record.toEntries(props.version.installScriptCommands), ([name, command]) => ({
    name,
    command,
    implicit: false,
  }));

  const implicit = EffectArray.filterMap(props.analysis?.scripts ?? [], (script) =>
    script.origin === 'implicit'
      ? Result.succeed({ name: script.name, command: script.command, implicit: true })
      : Result.failVoid,
  );

  return EffectArray.map(
    EffectArray.sortWith(
      EffectArray.appendAll(declared, implicit),
      (command: (typeof declared)[number]) => hookOrder.indexOf(command.name),
      Order.Number,
    ),
    (command) => ({
      ...command,
      changeLabel: command.implicit
        ? 'npm default'
        : Option.match(
            EffectArray.findFirst(props.changes, (change) => change.name === command.name),
            { onNone: () => 'unchanged', onSome: (change) => change.kind },
          ),
    }),
  );
});

const groups = computed(() => {
  const findings = props.analysis?.findings ?? [];
  const grouped = EffectArray.groupBy(findings, ({ kind }) => kind);

  return EffectArray.map(EffectArray.dedupe(EffectArray.map(findings, ({ kind }) => kind)), (kind) => ({
    kind,
    label: installActionLabels[kind],
    findings: EffectArray.map(grouped[kind] ?? [], (finding) => ({
      ...finding,
      sourceLink: installSourceLink(props.version.name, props.version.version, finding.path, finding.line),
    })),
  }));
});

const coverage = computed(() =>
  Match.value(props.analysis?.status).pipe(
    Match.when('unavailable', () => 'Install code unavailable.'),
    Match.when('partial', () => 'Install code partly checked.'),
    Match.orElse(() => 'Package files checked for supported code patterns.'),
  ),
);

const hasFollowedFiles = computed(() =>
  EffectArray.some(props.analysis?.scripts ?? [], (script) => script.files.length > 0),
);
</script>

<template>
  <section
    class="max-h-120 min-w-0 overflow-y-auto pr-3 focus-visible:outline-2 focus-visible:outline-ring"
    tabindex="0"
    :aria-label="`Installation for ${version.version}`"
  >
    <h3 class="mb-3 font-mono text-xs text-muted-foreground">{{ version.version }}</h3>
    <ul v-if="commands.length" class="space-y-3 text-xs leading-[1.7]">
      <li v-for="command in commands" :key="command.name">
        <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span class="font-medium">{{ command.name }}</span>
          <span class="text-[11px] text-muted-foreground">{{ command.changeLabel }}</span>
        </div>
        <code class="mt-1 block font-mono whitespace-pre-wrap wrap-anywhere">{{ command.command }}</code>
        <p v-if="command.implicit" class="mt-1 text-muted-foreground">
          npm may run this because the package includes a binding.gyp build file.
        </p>
      </li>
    </ul>
    <p v-else class="text-xs text-muted-foreground">No install scripts declared.</p>

    <p v-if="!analysis" class="mt-4 text-xs leading-[1.7] text-muted-foreground" role="status">
      {{ unavailable ? 'Package files unavailable. Declared commands are shown.' : 'Checking package files…' }}
    </p>
    <template v-else>
      <p class="mt-4 text-xs leading-[1.7] text-muted-foreground">
        {{ coverage }}
      </p>
      <details v-for="group in groups" :key="group.kind" class="mt-4 text-xs leading-[1.7]">
        <summary
          class="w-fit cursor-pointer font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {{ group.label }} <span class="font-normal text-muted-foreground">({{ group.findings.length }})</span>
        </summary>
        <ul class="mt-2 space-y-2 text-xs leading-[1.7]">
          <li
            v-for="(finding, index) in group.findings"
            :key="`${finding.script}:${finding.path}:${finding.line}:${index}`"
            class="min-w-0"
          >
            <p class="text-muted-foreground">
              {{ finding.script }}<span v-if="finding.detail"> · {{ finding.detail }}</span>
            </p>
            <details v-if="finding.excerpt" class="mt-1">
              <summary
                class="w-fit cursor-pointer underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                Show code
              </summary>
              <pre
                class="mt-2 max-h-48 overflow-auto rounded bg-background p-3 font-mono text-[11px] leading-[1.7] whitespace-pre-wrap wrap-anywhere"
                >{{ finding.excerpt }}</pre>
            </details>
            <a
              :href="finding.sourceLink"
              target="_blank"
              rel="noopener noreferrer"
              class="mt-1 inline-block font-mono text-[11px] underline underline-offset-4 wrap-anywhere focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {{ finding.path }}:{{ finding.line
              }}<span class="sr-only"> in {{ version.name }} {{ version.version }} on npmx (opens in a new tab)</span>
            </a>
          </li>
        </ul>
      </details>
      <p
        v-if="!groups.length && analysis.scripts.length && analysis.status !== 'unavailable'"
        class="mt-3 text-xs leading-[1.7] text-muted-foreground"
      >
        No matching calls found. Other actions may still occur.
      </p>
      <details v-if="hasFollowedFiles" class="mt-4 text-xs leading-[1.7]">
        <summary
          class="w-fit cursor-pointer underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Files followed from the install commands
        </summary>
        <ul class="mt-2 space-y-2">
          <li v-for="script in analysis.scripts" :key="script.name" class="wrap-anywhere">
            <span class="font-medium">{{ script.name }}</span>
            <ul class="mt-1 space-y-1">
              <li v-for="file in script.files" :key="file">
                <a
                  :href="installSourceLink(version.name, version.version, file, 1)"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="font-mono underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >{{ file }}<span class="sr-only"> on npmx (opens in a new tab)</span></a
                >
              </li>
            </ul>
          </li>
        </ul>
      </details>
      <div
        v-if="analysis.reasons.length || analysis.uninspectedPackages.length"
        class="mt-4 text-xs leading-[1.7] text-muted-foreground"
      >
        <h4 class="font-medium text-foreground">Not checked</h4>
        <ul class="mt-1 list-disc space-y-1 pl-4">
          <li v-if="analysis.uninspectedPackages.length">
            Packages not checked:
            <span class="font-mono wrap-anywhere">{{ EffectArray.join(analysis.uninspectedPackages, ', ') }}</span>
          </li>
          <li v-for="reason in analysis.reasons" :key="reason" class="wrap-anywhere">{{ reason }}</li>
        </ul>
      </div>
    </template>
  </section>
</template>
