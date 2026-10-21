<script setup lang="ts">
import { ref, useTemplateRef, watchPostEffect } from 'vue';

const props = defineProps<{ count: number; rows: string; label: string }>();

const viewport = useTemplateRef<HTMLDivElement>('viewport');

const maxHeight = ref<string>();

watchPostEffect((onCleanup) => {
  const element = viewport.value;

  if (!element) return;

  const rows = [...element.querySelectorAll<HTMLElement>(props.rows)].slice(0, 6);
  const count = props.count;

  const measure = () => {
    const last = rows[5];

    maxHeight.value =
      count > 6 && last
        ? `${last.getBoundingClientRect().bottom - element.getBoundingClientRect().top + element.scrollTop}px`
        : undefined;
  };

  const observer = new ResizeObserver(measure);

  for (const row of rows) observer.observe(row);

  observer.observe(element);
  measure();
  onCleanup(() => observer.disconnect());
});
</script>

<template>
  <div
    ref="viewport"
    class="min-w-0 overflow-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    :style="{ maxHeight }"
    :tabindex="count > 6 ? 0 : undefined"
    :role="count > 6 ? 'region' : undefined"
    :aria-label="count > 6 ? label : undefined"
  >
    <slot />
  </div>
</template>
