<script setup lang="ts">
import { cva, type VariantProps } from 'class-variance-authority';
import {
  SelectContent as RekaSelectContent,
  SelectIcon as RekaSelectIcon,
  SelectItem as RekaSelectItem,
  SelectItemIndicator as RekaSelectItemIndicator,
  SelectItemText as RekaSelectItemText,
  SelectPortal as RekaSelectPortal,
  SelectRoot as RekaSelectRoot,
  SelectTrigger as RekaSelectTrigger,
  SelectValue as RekaSelectValue,
  SelectViewport as RekaSelectViewport,
} from 'reka-ui';
import type { HTMLAttributes } from 'vue';
import { computed } from 'vue';

import { cn } from '~/utils/cn';

defineOptions({ inheritAttrs: false });

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

const selectTriggerVariants = cva(
  'flex w-full items-center justify-between gap-2 rounded-md border border-input bg-card/60 px-3 text-left text-sm text-foreground shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 data-[placeholder]:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      size: {
        default: 'h-10 py-2',
        lg: 'h-14 px-4 py-3 text-lg',
      },
    },
    defaultVariants: {
      size: 'default',
    },
  },
);

type SelectTriggerVariantProps = VariantProps<typeof selectTriggerVariants>;

interface SelectProps {
  options?: readonly SelectOption[];
  modelValue?: string | null;
  placeholder?: string;
  disabled?: boolean;
  size?: SelectTriggerVariantProps['size'];
  triggerId?: string;
  class?: HTMLAttributes['class'];
  triggerClass?: HTMLAttributes['class'];
  contentClass?: HTMLAttributes['class'];
  itemClass?: HTMLAttributes['class'];
}

const props = withDefaults(defineProps<SelectProps>(), {
  options: () => [],
  placeholder: 'Select a version',
  disabled: false,
  size: 'default',
});

const emit = defineEmits<{
  'update:modelValue': [value: string | null];
}>();

const selectedValue = computed<string | null>({
  get: () => props.modelValue ?? null,
  set: (value) => emit('update:modelValue', typeof value === 'string' ? value : null),
});

const selectedOption = computed(() => props.options.find((option) => option.value === selectedValue.value));
</script>

<template>
  <div data-slot="select" :class="cn('w-full', props.class)">
    <RekaSelectRoot v-model="selectedValue" :disabled="props.disabled">
      <RekaSelectTrigger
        v-bind="$attrs"
        :id="props.triggerId"
        data-slot="select-trigger"
        :class="cn(selectTriggerVariants({ size: props.size }), props.triggerClass)"
      >
        <RekaSelectValue :placeholder="props.placeholder">
          {{ selectedOption?.label ?? props.placeholder }}
        </RekaSelectValue>
        <RekaSelectIcon class="text-muted-foreground" aria-hidden="true">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.75" class="size-4">
            <path d="m5 7.5 5 5 5-5" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </RekaSelectIcon>
      </RekaSelectTrigger>

      <RekaSelectPortal>
        <RekaSelectContent
          position="popper"
          :side-offset="4"
          :class="
            cn(
              'z-50 max-h-80 min-w-[var(--reka-popper-anchor-width)] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md',
              props.contentClass,
            )
          "
        >
          <RekaSelectViewport>
            <RekaSelectItem
              v-for="option in props.options"
              :key="option.value"
              :value="option.value"
              :disabled="option.disabled ?? false"
              :class="
                cn(
                  'relative flex w-full cursor-default select-none items-center rounded-sm py-2 pl-8 pr-2 text-sm outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground',
                  props.itemClass,
                )
              "
            >
              <RekaSelectItemIndicator class="absolute left-2 inline-flex items-center justify-center">
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" class="size-4">
                  <path d="m4 10 4 4 8-8" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </RekaSelectItemIndicator>
              <RekaSelectItemText>{{ option.label }}</RekaSelectItemText>
            </RekaSelectItem>
          </RekaSelectViewport>
        </RekaSelectContent>
      </RekaSelectPortal>
    </RekaSelectRoot>
  </div>
</template>
