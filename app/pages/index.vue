<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import { navigateTo } from '#imports';
import { compareSemver } from '#shared/compareSemver';
import Button from '~/components/element/Button.vue';
import Combobox, { type ComboboxOption } from '~/components/form/Combobox.vue';
import type { SelectOption, SelectSearch } from '~/components/form/select.defs';
import Select from '~/components/form/Select.vue';
import { usePackageMetadataQuery } from '~/composables/usePackageMetadataQuery';
import { usePackageSearchQuery } from '~/composables/usePackageSearchQuery';

import { filterVersionOptions } from './versionSearch';

const TAG_OPTION_PREFIX = 'tag:';
const VERSION_OPTION_PREFIX = 'version:';

const versionSearch: SelectSearch = {
  filter: filterVersionOptions,
  placeholder: 'Search versions',
  emptyMessage: 'No matching versions',
};

const searchTerm = ref('');
const versionSelectAnchor = ref<HTMLElement | null>(null);
const selectedPackage = ref<string | null>(null);
const { data: searchResult, error, isError, isFetching } = usePackageSearchQuery(searchTerm);
const {
  data: packageMetadata,
  isError: isMetadataError,
  isFetching: isMetadataFetching,
} = usePackageMetadataQuery(selectedPackage);
const packageOptions = computed<readonly ComboboxOption[]>(
  () =>
    searchResult.value?.data.map(({ name, version, description }) => ({
      value: name,
      label: name,
      meta: version,
      ...(description === undefined ? {} : { description }),
    })) ?? [],
);
const versionByOptionValue = computed(() => {
  const versions = new Map<string, string>();
  const metadata = packageMetadata.value;

  if (metadata === undefined) {
    return versions;
  }

  for (const [tag, version] of Object.entries(metadata.distTags)) {
    versions.set(`${TAG_OPTION_PREFIX}${tag}`, version);
  }

  for (const version of metadata.versions) {
    versions.set(`${VERSION_OPTION_PREFIX}${version}`, version);
  }

  return versions;
});
const versionOptions = computed<readonly SelectOption[]>(() => {
  const metadata = packageMetadata.value;

  if (metadata === undefined) {
    return [];
  }

  const distTagOptions = Object.entries(metadata.distTags).map(([tag, version]) => ({
    value: `${TAG_OPTION_PREFIX}${tag}`,
    label: tag,
    description: version,
  }));
  const packageVersionOptions = metadata.versions.map((version, index) => ({
    value: `${VERSION_OPTION_PREFIX}${version}`,
    label: version,
    ...(index === 0 && distTagOptions.length > 0 ? { separatorBefore: true } : {}),
  }));

  return [...distTagOptions, ...packageVersionOptions];
});
const fromVersionSelection = ref<string | null>(null);
const toVersionSelection = ref<string | null>(null);
const selectedFromVersion = computed(() =>
  fromVersionSelection.value === null ? null : (versionByOptionValue.value.get(fromVersionSelection.value) ?? null),
);
const selectedToVersion = computed(() =>
  toVersionSelection.value === null ? null : (versionByOptionValue.value.get(toVersionSelection.value) ?? null),
);
const toVersionOptions = computed<readonly SelectOption[]>(() => {
  const fromVersion = selectedFromVersion.value;

  if (fromVersion === null) {
    return versionOptions.value;
  }

  const filteredOptions = versionOptions.value.filter((option) => {
    const version = versionByOptionValue.value.get(option.value);

    return version !== undefined && compareSemver(version, fromVersion) >= 0;
  });
  const firstVersionIndex = filteredOptions.findIndex((option) => option.value.startsWith(VERSION_OPTION_PREFIX));

  if (firstVersionIndex <= 0) {
    return filteredOptions;
  }

  return filteredOptions.map((option, index) =>
    index === firstVersionIndex ? { ...option, separatorBefore: true } : option,
  );
});
const versionSelectDisabled = computed(
  () => isMetadataFetching.value || packageMetadata.value === undefined || versionOptions.value.length === 0,
);
const versionPlaceholder = computed(() => {
  if (isMetadataFetching.value) {
    return 'Loading…';
  }

  if (isMetadataError.value) {
    return 'Unavailable';
  }

  return '—';
});
const canCompare = computed(
  () => selectedPackage.value !== null && selectedFromVersion.value !== null && selectedToVersion.value !== null,
);
const compare = () => {
  const packageName = selectedPackage.value;
  const fromVersion = selectedFromVersion.value;
  const toVersion = selectedToVersion.value;

  if (packageName === null || fromVersion === null || toVersion === null) {
    return;
  }

  void navigateTo(`/${encodeURIComponent(packageName)}/${fromVersion}...${toVersion}`);
};

watch(selectedPackage, () => {
  fromVersionSelection.value = null;
  toVersionSelection.value = null;
});

watch(packageMetadata, (metadata) => {
  if (metadata === undefined) {
    return;
  }

  if (metadata.distTags.latest !== undefined) {
    toVersionSelection.value = `${TAG_OPTION_PREFIX}latest`;
    return;
  }

  const newestVersion = metadata.versions[0];

  if (newestVersion !== undefined) {
    toVersionSelection.value = `${VERSION_OPTION_PREFIX}${newestVersion}`;
  }
});

watch(selectedFromVersion, () => {
  if (toVersionSelection.value === null) {
    return;
  }

  if (!toVersionOptions.value.some((option) => option.value === toVersionSelection.value)) {
    toVersionSelection.value = null;
  }
});
</script>

<template>
  <main class="min-h-svh bg-background px-4 py-6 text-foreground sm:px-6">
    <div class="mx-auto flex min-h-[calc(100svh-3rem)] w-full max-w-6xl flex-col justify-center pb-16">
      <header class="mx-auto max-w-2xl space-y-4 text-center">
        <p class="font-mono font-semibold tracking-[-0.04em]">
          can i update<span class="text-change" aria-hidden="true">?</span>
        </p>
        <h1 class="text-4xl font-medium tracking-tight sm:text-6xl">
          Check what changes before you update an npm package.
        </h1>
      </header>

      <section class="mx-auto mt-10 w-full max-w-5xl">
        <div class="flex flex-col gap-3 items-center">
          <div class="min-w-0 w-full" role="search" aria-label="Search npm packages">
            <div class="grid gap-3 lg:grid-cols-[minmax(0,1fr)_12rem_12rem] lg:items-start">
              <div class="min-w-0">
                <div class="space-y-2">
                  <label
                    for="package-search"
                    class="block text-xs font-medium uppercase tracking-wide text-muted-foreground"
                  >
                    Package name
                  </label>
                  <Combobox
                    input-id="package-search"
                    data-testid="package-search"
                    :options="packageOptions"
                    :loading="isFetching"
                    v-model="selectedPackage"
                    v-model:search-term="searchTerm"
                    @search="selectedPackage = null"
                  />
                </div>
                <p v-if="isError" class="mt-2 text-sm text-destructive" aria-live="polite">
                  {{ error?.message ?? 'Unable to search npm packages.' }}
                </p>
              </div>

              <div ref="versionSelectAnchor" class="grid gap-3 sm:grid-cols-2 lg:col-span-2">
                <div class="space-y-2">
                  <label
                    for="from-version"
                    class="block text-xs font-medium uppercase tracking-wide text-muted-foreground"
                  >
                    From version
                  </label>
                  <Select
                    trigger-id="from-version"
                    data-testid="from-version"
                    aria-label="From version"
                    :anchor="versionSelectAnchor"
                    :placeholder="versionPlaceholder"
                    size="lg"
                    :options="versionOptions"
                    :search="versionSearch"
                    :model-value="fromVersionSelection"
                    :disabled="versionSelectDisabled"
                    @update:model-value="fromVersionSelection = $event"
                  />
                </div>

                <div class="space-y-2">
                  <label
                    for="to-version"
                    class="block text-xs font-medium uppercase tracking-wide text-muted-foreground"
                  >
                    To version
                  </label>
                  <Select
                    trigger-id="to-version"
                    data-testid="to-version"
                    aria-label="To version"
                    :anchor="versionSelectAnchor"
                    :placeholder="versionPlaceholder"
                    size="lg"
                    :options="toVersionOptions"
                    :search="versionSearch"
                    :model-value="toVersionSelection"
                    :disabled="versionSelectDisabled"
                    @update:model-value="toVersionSelection = $event"
                  />
                </div>
              </div>
            </div>
          </div>
          <p class="text-sm text-faded-foreground w-full text-center" aria-live="polite">
            Instant search, start typing to search package. Minimum 2 characters.
          </p>
          <Button
            data-testid="compare"
            size="lg"
            class="h-14 w-full max-w-64 mt-8"
            :disabled="!canCompare"
            @click="compare"
          >
            Compare versions
          </Button>
        </div>
      </section>
    </div>
  </main>
</template>
