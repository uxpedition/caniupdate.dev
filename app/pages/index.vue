<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';

import Button from '~/components/element/Button.vue';

const count = ref(0);
const colorScheme = ref<'light' | 'dark'>('light');

let mediaQuery: MediaQueryList | undefined;
let colorSchemeObserver: MutationObserver | undefined;

const syncColorScheme = () => {
  const scheme = getComputedStyle(document.documentElement).colorScheme;
  colorScheme.value = scheme === 'dark' ? 'dark' : 'light';
};

onMounted(() => {
  syncColorScheme();

  mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  mediaQuery.addEventListener('change', syncColorScheme);

  colorSchemeObserver = new MutationObserver(syncColorScheme);
  colorSchemeObserver.observe(document.documentElement, {
    attributeFilter: ['class'],
    attributes: true,
  });
});

onBeforeUnmount(() => {
  mediaQuery?.removeEventListener('change', syncColorScheme);
  colorSchemeObserver?.disconnect();
});
</script>

<template>
  <main class="min-h-svh bg-background px-6 py-16 text-foreground">
    <div class="mx-auto flex max-w-2xl flex-col gap-8">
      <header class="space-y-3">
        <p class="text-sm font-medium text-muted-foreground">Can I npm update?</p>
        <h1 class="text-4xl font-semibold tracking-tight">A small design system check.</h1>
        <p class="max-w-xl text-muted-foreground">
          This page uses the semantic theme tokens and Button primitive wired into the app.
        </p>
      </header>

      <section class="grid gap-4 sm:grid-cols-2">
        <article class="rounded-lg border bg-card p-6 text-card-foreground shadow-xs">
          <p class="text-sm font-medium text-muted-foreground">Current color scheme</p>
          <p data-testid="color-scheme" class="mt-3 text-3xl font-semibold capitalize">
            {{ colorScheme }}
          </p>
          <p class="mt-2 text-sm text-muted-foreground">Resolved from the browser's active color scheme.</p>
        </article>

        <article class="rounded-lg border bg-card p-6 text-card-foreground shadow-xs">
          <p class="text-sm font-medium text-muted-foreground">Counter</p>
          <p data-testid="counter" class="mt-3 text-3xl font-semibold">{{ count }}</p>
          <div class="mt-4 flex gap-2">
            <Button data-testid="increment" @click="count += 1">Increment</Button>
            <Button data-testid="reset" variant="outline" @click="count = 0">Reset</Button>
          </div>
        </article>
      </section>
    </div>
  </main>
</template>
