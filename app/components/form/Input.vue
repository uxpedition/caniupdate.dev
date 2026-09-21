<script setup lang="ts">
import { cva, type VariantProps } from 'class-variance-authority';
import { Primitive, type PrimitiveProps } from 'reka-ui';
import type { HTMLAttributes } from 'vue';

import { cn } from '~/utils/cn';

defineOptions({ inheritAttrs: false });

const inputVariants = cva(
  'flex w-full rounded-md border border-input bg-muted text-foreground shadow-xs outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      size: {
        default: 'h-10 px-3 py-2 text-sm',
        lg: 'h-14 px-4 py-3 text-lg',
      },
    },
    defaultVariants: {
      size: 'default',
    },
  },
);

type InputVariantProps = VariantProps<typeof inputVariants>;

interface InputProps extends PrimitiveProps {
  size?: InputVariantProps['size'];
  class?: HTMLAttributes['class'];
}

const props = withDefaults(defineProps<InputProps>(), {
  as: 'input',
  asChild: false,
  size: 'default',
});
</script>

<template>
  <Primitive
    v-bind="$attrs"
    :as="props.as"
    :as-child="props.asChild"
    data-slot="input"
    :class="cn(inputVariants({ size: props.size }), props.class)"
  />
</template>
