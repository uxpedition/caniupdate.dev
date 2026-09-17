<script setup lang="ts">
import { computed, ref } from 'vue';

import Combobox, { type ComboboxOption } from '~/components/form/Combobox.vue';
import Select, { type SelectOption } from '~/components/form/Select.vue';
import { usePackageSearchQuery } from '~/composables/usePackageSearchQuery';

const searchTerm = ref('');
const selectedPackage = ref<string | null>(null);
const { data: searchResult, error, isError, isFetching } = usePackageSearchQuery(searchTerm);
const packageOptions = computed<readonly ComboboxOption[]>(
  () =>
    searchResult.value?.data.map(({ name, version, description }) => ({
      value: name,
      label: name,
      meta: version,
      ...(description === undefined ? {} : { description }),
    })) ?? [],
);
const versionOptions: readonly SelectOption[] = [{ value: 'latest', label: 'latest' }];
const fromVersion = ref<string | null>(null);
const toVersion = ref('latest');
</script>

<template>
  <main class="min-h-svh bg-background px-4 py-6 text-foreground sm:px-6">
    <div class="mx-auto flex min-h-[calc(100svh-3rem)] w-full max-w-6xl flex-col justify-center">
      <header class="mx-auto max-w-2xl space-y-4 text-center">
        <p class="text-base italic leading-7 text-muted-foreground sm:text-lg">Can I npm update?</p>
        <h1 class="text-4xl italic font-medium tracking-tight sm:text-6xl">Know before you update.</h1>
      </header>

      <section class="mx-auto mt-10 w-full max-w-5xl">
        <div role="search" aria-label="Search npm packages">
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
                />
              </div>
              <p v-if="isError" class="mt-2 text-sm text-destructive" aria-live="polite">
                {{ error?.message ?? 'Unable to search npm packages.' }}
              </p>
              <p v-else class="mt-2 text-sm text-faded-foreground" aria-live="polite">
                Instant search, start typing to search package. Minimum 2 characters.
              </p>
            </div>

            <div class="space-y-2">
              <label for="from-version" class="block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                From version
              </label>
              <Select
                trigger-id="from-version"
                data-testid="from-version"
                aria-label="From version"
                placeholder="—"
                size="lg"
                :options="versionOptions"
                :model-value="fromVersion"
                disabled
              />
            </div>

            <div class="space-y-2">
              <label for="to-version" class="block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                To version
              </label>
              <Select
                trigger-id="to-version"
                data-testid="to-version"
                aria-label="To version"
                size="lg"
                :options="versionOptions"
                :model-value="toVersion"
                disabled
              />
            </div>
          </div>
        </div>
      </section>
    </div>
  </main>
</template>
