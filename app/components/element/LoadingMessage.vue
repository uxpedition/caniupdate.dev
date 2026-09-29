<script setup lang="ts">
import { LoaderCircle } from '@lucide/vue';
import { Primitive, type PrimitiveProps } from 'reka-ui';
import type { HTMLAttributes } from 'vue';

import { cn } from '~/utils/cn';

defineOptions({ inheritAttrs: false });

interface LoadingMessageProps extends PrimitiveProps {
  as: NonNullable<PrimitiveProps['as']>;
  loadingText: string;
  class?: HTMLAttributes['class'];
}

const props = withDefaults(defineProps<LoadingMessageProps>(), {
  asChild: false,
});
</script>

<template>
  <Primitive
    v-bind="$attrs"
    :as="props.as"
    :as-child="props.asChild"
    role="status"
    :class="cn('flex items-center gap-2 font-mono text-sm text-muted-foreground', props.class)"
  >
    <LoaderCircle aria-hidden="true" class="size-4 shrink-0 motion-safe:animate-spin" />
    {{ props.loadingText }}
  </Primitive>
</template>
