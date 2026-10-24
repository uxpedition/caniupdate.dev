<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ name: string; from: string; to: string }>();

const emit = defineEmits<{ navigate: [] }>();

const destination = computed(
  () => `/resolve/${encodeURIComponent(props.name)}?${new URLSearchParams({ from: props.from, to: props.to })}`,
);
</script>

<template>
  <a
    :href="destination"
    title="Compare the lowest published versions matching these ranges"
    class="block rounded-xs underline underline-offset-4 hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    @click="emit('navigate')"
  >
    <span class="font-medium">{{ name }}</span>
    <span class="font-mono">{{ ` ${from} → ${to}` }}</span>
  </a>
</template>
