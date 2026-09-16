<script setup lang="ts">
import { useNuxtLatestQuery } from '~/composables/useNuxtLatestDemoQuery';

const { data, isPending } = useNuxtLatestQuery();
</script>

<template>
  <aside class="rounded-lg border bg-card p-6 text-card-foreground shadow-xs" data-testid="shared-consumer">
    <p class="text-sm font-medium text-muted-foreground">Second query consumer</p>
    <p v-if="data" class="mt-3 text-lg font-semibold">{{ data.name }}@{{ data.version }}</p>
    <p v-else-if="isPending" class="mt-3 text-sm text-muted-foreground">Loading from the shared query cache…</p>
    <p v-else class="mt-3 text-sm text-muted-foreground">No cached version is available.</p>
    <p class="mt-2 text-sm text-muted-foreground">
      This component uses the same query key and reuses the page query's fresh result.
    </p>
  </aside>
</template>
