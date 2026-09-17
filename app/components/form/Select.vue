<script setup lang="ts">
import { cva, type VariantProps } from 'class-variance-authority';
import {
  ListboxRoot,
  ListboxContent,
  ListboxItem,
  ListboxItemIndicator,
  ListboxVirtualizer,
  PopoverRoot,
  PopoverTrigger,
  PopoverPortal,
  PopoverContent,
} from 'reka-ui';
import type { HTMLAttributes } from 'vue';
import { computed, nextTick, ref, watch } from 'vue';

import { cn } from '~/utils/cn';

defineOptions({ inheritAttrs: false });

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
  separatorBefore?: boolean;
}

const NUMERIC_TERM_PATTERN = /^[\d.]+$/;
const NUMERIC_SEGMENT_PATTERN = /^\d+$/;
const ROW_HEIGHT = 36;

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
  anchor?: HTMLElement | null;
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
  anchor: null,
});

const emit = defineEmits<{
  'update:modelValue': [value: string | null];
}>();

const selectedValue = computed<string | null>({
  get: () => props.modelValue ?? null,
  set: (value) => emit('update:modelValue', typeof value === 'string' ? value : null),
});

const open = ref(false);
const searchTerm = ref('');
const searchInputRef = ref<HTMLInputElement | null>(null);
const listboxRef = ref<HTMLElement | null>(null);

watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) open.value = false;
  },
);

watch(open, (isOpen) => {
  if (!isOpen) {
    searchTerm.value = '';
    return;
  }

  void nextTick(() => searchInputRef.value?.focus());
});

const optionsByValue = computed(() => new Map(props.options.map((option) => [option.value, option])));
const numericSkeleton = (text: string) =>
  text
    .split(/[.-]/)
    .filter((segment) => NUMERIC_SEGMENT_PATTERN.test(segment))
    .join('.');
const termRank = (text: string, term: string): number | null => {
  const target = NUMERIC_TERM_PATTERN.test(term) ? numericSkeleton(text) : text;

  if (target.startsWith(term)) {
    return 0;
  }

  let index = target.indexOf(term, 1);

  while (index !== -1) {
    const boundary = target[index - 1];

    if (boundary === '.' || boundary === '-') {
      return 1;
    }

    index = target.indexOf(term, index + 1);
  }

  return text.includes(term) ? 2 : null;
};
const optionTermRank = (option: SelectOption, term: string): number | null => {
  const labelRank = termRank(option.label.toLowerCase(), term);

  if (option.description === undefined) {
    return labelRank;
  }

  const descriptionRank = termRank(option.description.toLowerCase(), term);

  if (labelRank === null || descriptionRank === null) {
    return labelRank ?? descriptionRank;
  }

  return Math.min(labelRank, descriptionRank);
};
const visibleOptions = computed(() => {
  const term = searchTerm.value.trim().toLowerCase();

  if (term.length === 0) {
    return props.options;
  }

  const prefixMatches: SelectOption[] = [];
  const segmentMatches: SelectOption[] = [];
  const otherMatches: SelectOption[] = [];

  for (const option of props.options) {
    const rank = optionTermRank(option, term);

    if (rank === null) {
      continue;
    }

    if (rank === 0) {
      prefixMatches.push(option);
    } else if (rank === 1) {
      segmentMatches.push(option);
    } else {
      otherMatches.push(option);
    }
  }

  return [...prefixMatches, ...segmentMatches, ...otherMatches];
});
const visibleOptionValues = computed(() => visibleOptions.value.map((option) => option.value));
const hasSeparator = (index: number) =>
  searchTerm.value.trim().length === 0 && index > 0 && (visibleOptions.value[index]?.separatorBefore ?? false);
const focusListbox = () => {
  const scope = listboxRef.value;
  const target =
    scope?.querySelector<HTMLElement>('[data-highlighted]') ?? scope?.querySelector<HTMLElement>('[role="listbox"]');

  target?.focus();
};
const selectValue = (value: unknown) => {
  selectedValue.value = typeof value === 'string' ? value : null;
  open.value = false;
};
const selectedOption = computed(() => props.options.find((option) => option.value === selectedValue.value));
</script>

<template>
  <div data-slot="select" :class="cn('w-full', props.class)">
    <PopoverRoot v-model:open="open">
      <PopoverTrigger as-child>
        <button
          v-bind="$attrs"
          :id="props.triggerId"
          type="button"
          role="combobox"
          aria-haspopup="listbox"
          :disabled="props.disabled"
          :data-placeholder="selectedOption ? undefined : ''"
          data-slot="select-trigger"
          :class="cn(selectTriggerVariants({ size: props.size }), props.triggerClass)"
          @keydown.down.prevent="open = true"
          @keydown.up.prevent="open = true"
        >
          <span class="min-w-0 truncate">{{ selectedOption?.label ?? props.placeholder }}</span>
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            stroke-width="1.75"
            class="size-4 shrink-0 text-muted-foreground"
          >
            <path d="m5 7.5 5 5 5-5" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent
          v-bind="props.anchor === null ? {} : { reference: props.anchor }"
          :side-offset="4"
          align="start"
          :class="
            cn(
              'z-50 w-[var(--reka-popper-anchor-width)] max-w-[var(--reka-popper-available-width)] rounded-md border bg-popover p-1 text-popover-foreground shadow-md',
              props.contentClass,
            )
          "
        >
          <div class="p-1 pb-2">
            <input
              ref="searchInputRef"
              v-model="searchTerm"
              type="search"
              autocomplete="off"
              spellcheck="false"
              aria-label="Search versions"
              placeholder="Search versions"
              class="w-full rounded-sm border border-input bg-card/60 px-2 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              @keydown.down.prevent="focusListbox"
              @keydown.up.prevent="focusListbox"
            />
          </div>
          <div ref="listboxRef">
            <ListboxRoot
              :model-value="selectedValue"
              selection-behavior="replace"
              highlight-on-hover
              @update:model-value="selectValue"
            >
              <ListboxContent
                :aria-label="$attrs['aria-label']"
                :class="cn('overflow-y-auto overflow-x-hidden', visibleOptions.length > 0 && 'h-80')"
              >
                <ListboxVirtualizer
                  v-slot="{ option, virtualItem }"
                  :options="visibleOptionValues"
                  :estimate-size="ROW_HEIGHT"
                  :overscan="8"
                  :text-content="(value) => optionsByValue.get(value)?.label ?? value"
                >
                  <ListboxItem
                    :value="option"
                    :disabled="optionsByValue.get(option)?.disabled ?? false"
                    :style="{ height: ROW_HEIGHT + 'px' }"
                    :class="
                      cn(
                        'relative flex w-full cursor-default select-none items-center overflow-hidden rounded-sm pl-8 pr-2 text-sm outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground',
                        props.itemClass,
                      )
                    "
                  >
                    <span
                      v-if="hasSeparator(virtualItem.index)"
                      aria-hidden="true"
                      class="absolute inset-x-0 top-0 h-px bg-border"
                    />
                    <ListboxItemIndicator class="absolute left-2 top-1/2 -translate-y-1/2">
                      <svg
                        aria-hidden="true"
                        viewBox="0 0 20 20"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        class="size-4"
                      >
                        <path d="m4 10 4 4 8-8" stroke-linecap="round" stroke-linejoin="round" />
                      </svg>
                    </ListboxItemIndicator>
                    <span class="flex min-w-0 flex-1 items-baseline gap-2">
                      <span class="truncate">{{ optionsByValue.get(option)?.label }}</span>
                      <span
                        v-if="optionsByValue.get(option)?.description"
                        class="truncate text-xs text-muted-foreground"
                        >{{ optionsByValue.get(option)?.description }}</span
                      >
                    </span>
                  </ListboxItem>
                </ListboxVirtualizer>
              </ListboxContent>
              <p v-if="visibleOptions.length === 0" class="px-2 py-6 text-center text-sm text-muted-foreground">
                No matching versions
              </p>
            </ListboxRoot>
          </div>
        </PopoverContent>
      </PopoverPortal>
    </PopoverRoot>
  </div>
</template>
