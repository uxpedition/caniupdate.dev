<script setup lang="ts">
import { ChevronRight } from '@lucide/vue';

import RowHelp from '~/components/comparison/RowHelp.vue';

import type { SurfaceVersion } from './packageSurface.defs';

defineProps<{ versions: readonly SurfaceVersion[] }>();
</script>

<template>
  <details class="group mt-5 border-t border-border text-xs leading-relaxed">
    <summary
      class="flex w-fit cursor-pointer list-none items-center gap-2 rounded py-3 text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden"
    >
      <ChevronRight :size="14" aria-hidden="true" class="shrink-0 group-open:rotate-90" />
      Package details
    </summary>
    <table class="w-full table-fixed border-collapse text-left">
      <colgroup>
        <col class="w-[28%]" />
        <col class="w-[36%]" />
        <col class="w-[36%]" />
      </colgroup>
      <thead>
        <tr class="border-b border-border">
          <td class="py-2" />
          <th
            v-for="(version, index) in versions"
            :key="index"
            scope="col"
            class="px-2 py-2 font-mono font-normal wrap-anywhere"
          >
            {{ version.version }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr id="comparison-module-format" class="scroll-mt-6 border-b border-border/55">
          <th scope="row" class="py-3 pr-2 align-top font-normal wrap-anywhere">JavaScript</th>
          <td v-for="(version, index) in versions" :key="index" class="px-2 py-3 align-top wrap-anywhere">
            <dl v-if="version.moduleFields.length" class="space-y-2">
              <div v-for="(field, fieldIndex) in version.moduleFields" :key="field.name">
                <dt class="flex items-start justify-between text-muted-foreground">
                  <span>{{ field.name }}</span>
                  <RowHelp
                    v-if="fieldIndex === 0"
                    :label="`JavaScript in ${version.version}`"
                    :explanation="version.moduleDescription"
                  />
                </dt>
                <dd class="font-mono">{{ field.value }}</dd>
              </div>
            </dl>
            <div v-else class="flex items-start text-muted-foreground">
              <span>Not declared</span>
              <RowHelp :label="`JavaScript in ${version.version}`" :explanation="version.moduleDescription" />
            </div>
          </td>
        </tr>
        <tr id="comparison-types" class="scroll-mt-6">
          <th scope="row" class="py-3 pr-2 align-top font-normal wrap-anywhere">
            <div class="flex items-start">
              <span>Types</span>
              <RowHelp
                label="Type declarations"
                explanation="Declared type paths, not a comparison of their APIs. Missing declarations do not prove types are absent. Path-specific types also appear in path previews."
              />
            </div>
          </th>
          <td v-for="(version, index) in versions" :key="index" class="px-2 py-3 align-top wrap-anywhere">
            <ul
              v-if="version.types.length"
              tabindex="0"
              :aria-label="`Type entries for ${version.version}`"
              class="max-h-64 space-y-2 overflow-auto focus-visible:outline-2 focus-visible:outline-ring"
            >
              <li v-for="(branch, branchIndex) in version.types" :key="branchIndex">
                <p class="text-muted-foreground">{{ branch.conditions.join(' → ') }}</p>
                <code>{{ branch.target ?? 'Blocked (null)' }}</code>
              </li>
            </ul>
            <p v-else class="text-muted-foreground">Not declared</p>
            <details v-if="version.typeMappings.length" class="mt-3">
              <summary
                class="cursor-pointer rounded text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring"
              >
                Compiler-version rules ({{ version.typeMappings.length }})
              </summary>
              <div class="mt-2 flex items-start">
                <span class="text-muted-foreground">Applied in declaration order</span>
                <RowHelp
                  label="Compiler-version rules"
                  explanation="Compiler ranges and path replacements are listed in declaration order. The applicable rule depends on your TypeScript version and resolution settings."
                />
              </div>
              <ul
                tabindex="0"
                :aria-label="`Compiler-version mappings for ${version.version}`"
                class="max-h-64 space-y-3 overflow-auto focus-visible:outline-2 focus-visible:outline-ring"
              >
                <li v-for="(mapping, mappingIndex) in version.typeMappings" :key="mappingIndex">
                  <p>
                    TypeScript <code>{{ mapping.compiler }}</code> · <code>{{ mapping.path }}</code>
                  </p>
                  <ol class="mt-1 text-muted-foreground">
                    <li v-for="(target, targetIndex) in mapping.targets" :key="targetIndex">
                      <span>{{ targetIndex + 1 }}. </span><code>{{ target }}</code>
                    </li>
                  </ol>
                  <p v-if="!mapping.targets.length" class="text-muted-foreground">No recognized target paths.</p>
                </li>
              </ul>
            </details>
          </td>
        </tr>
      </tbody>
    </table>
  </details>
</template>
