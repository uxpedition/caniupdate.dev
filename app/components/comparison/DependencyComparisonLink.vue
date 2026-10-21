<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query';
import { minSatisfying } from 'semver';
import { computed } from 'vue';

import { useRequestFetch } from '#imports';
import { comparisonPath } from '~/composables/comparisonFormState';
import { packageMetadataQueryOptions } from '~/composables/packageMetadataQueryOptions';

const props = defineProps<{ name: string; from: string; to: string }>();

const emit = defineEmits<{ navigate: [] }>();

const metadata = useQuery(packageMetadataQueryOptions(useRequestFetch(), () => props.name));

const destination = computed(() => {
  const versions = metadata.data.value?.versions;

  if (!versions) return null;

  const fromVersion = minSatisfying(versions, props.from);
  const toVersion = minSatisfying(versions, props.to);

  return fromVersion && toVersion ? comparisonPath({ packageName: props.name, fromVersion, toVersion }) : null;
});
</script>

<template>
  <NuxtLink
    v-if="destination"
    :to="destination"
    title="Compare the lowest published versions matching these ranges"
    class="block rounded-xs underline underline-offset-4 hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    @click="emit('navigate')"
  >
    <span class="font-medium">{{ name }}</span>
    <span class="font-mono">{{ ` ${from} → ${to}` }}</span>
  </NuxtLink>
  <span v-else class="block">
    <span class="font-medium">{{ name }}</span>
    <span class="font-mono">{{ ` ${from} → ${to}` }}</span>
    <span class="block text-[11px]">{{
      metadata.isPending.value
        ? 'Finding matching releases…'
        : 'Comparison unavailable: no matching releases or package metadata unavailable.'
    }}</span>
  </span>
</template>
