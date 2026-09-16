<script setup lang="ts">
import { onServerPrefetch } from 'vue';

import Button from '~/components/element/Button.vue';
import NuxtLatestSharedConsumer from '~/components/query-demo/NuxtLatestSharedConsumer.vue';
import { useNuxtLatestQuery } from '~/composables/useNuxtLatestDemoQuery';

const { data, error, isError, isFetching, isPending, refetch, suspense } = useNuxtLatestQuery();

onServerPrefetch(async () => {
  try {
    await suspense();
  } catch {
    // Keep rendering the demo so the query error state and retry action remain visible.
  }
});

const refresh = async (): Promise<void> => {
  await refetch();
};
</script>

<template>
  <main class="min-h-svh bg-background px-6 py-16 text-foreground">
    <div class="mx-auto flex max-w-2xl flex-col gap-8">
      <header class="space-y-3">
        <p class="text-sm font-medium text-muted-foreground">TanStack Vue Query integration</p>
        <h1 class="text-4xl font-semibold tracking-tight">Latest Nuxt version</h1>
        <p class="max-w-xl text-muted-foreground">
          The version below is prefetched on the server, dehydrated into the Nuxt payload, and hydrated into the browser
          query cache.
        </p>
      </header>

      <section class="rounded-lg border bg-card p-6 text-card-foreground shadow-xs" aria-live="polite">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p class="text-sm font-medium text-muted-foreground">npm package</p>
            <div v-if="data" data-testid="package-result">
              <p class="mt-3 text-3xl font-semibold">{{ data.name }}</p>
              <p class="mt-1 text-lg text-muted-foreground">{{ data.version }}</p>
            </div>
            <p v-else-if="isPending" class="mt-3 text-lg text-muted-foreground" data-testid="loading">
              Loading latest version…
            </p>
          </div>

          <Button data-testid="refresh" :disabled="isFetching" @click="refresh">
            {{ isError ? 'Retry' : 'Refresh' }}
          </Button>
        </div>

        <p v-if="isFetching && data" class="mt-4 text-sm text-muted-foreground" data-testid="background-refresh">
          Refreshing in the background…
        </p>
        <p v-if="isError" class="mt-4 text-sm text-destructive" data-testid="error">
          {{ error?.message ?? 'Unable to load the latest Nuxt version.' }}
        </p>
      </section>

      <NuxtLatestSharedConsumer />
    </div>
  </main>
</template>
