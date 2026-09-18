<script setup lang="ts">
import { computed } from 'vue';

import { useRoute } from '#imports';

const VERSION_SEPARATOR = '...';

const route = useRoute();
const routeParam = (value: string | string[] | undefined) => (typeof value === 'string' ? value : '');
const packageName = computed(() => routeParam(route.params.packageName));
const versions = computed(() => {
  const [from = '', to = ''] = routeParam(route.params.versionPair).split(VERSION_SEPARATOR);

  return { from, to };
});
</script>

<template>
  <main class="min-h-svh bg-background px-4 py-6 text-foreground sm:px-6">
    <div class="mx-auto flex w-full max-w-5xl flex-col gap-6 py-10">
      <header class="space-y-2">
        <p class="text-base italic leading-7 text-muted-foreground">Can I npm update?</p>
        <h1 class="text-3xl font-medium tracking-tight">{{ packageName }} {{ versions.from }} → {{ versions.to }}</h1>
      </header>

      <dl class="grid gap-3 text-sm sm:grid-cols-3">
        <div class="rounded-md border border-input bg-card/60 p-3">
          <dt class="text-xs font-medium uppercase tracking-wide text-muted-foreground">Package</dt>
          <dd data-testid="comparison-package" class="mt-1">{{ packageName }}</dd>
        </div>
        <div class="rounded-md border border-input bg-card/60 p-3">
          <dt class="text-xs font-medium uppercase tracking-wide text-muted-foreground">From version</dt>
          <dd data-testid="comparison-from" class="mt-1">{{ versions.from }}</dd>
        </div>
        <div class="rounded-md border border-input bg-card/60 p-3">
          <dt class="text-xs font-medium uppercase tracking-wide text-muted-foreground">To version</dt>
          <dd data-testid="comparison-to" class="mt-1">{{ versions.to }}</dd>
        </div>
      </dl>
    </div>
  </main>
</template>
