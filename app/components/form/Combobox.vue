<script setup lang="ts">
import {
  ComboboxAnchor as RekaComboboxAnchor,
  ComboboxContent as RekaComboboxContent,
  ComboboxEmpty as RekaComboboxEmpty,
  ComboboxInput as RekaComboboxInput,
  ComboboxItem as RekaComboboxItem,
  ComboboxItemIndicator as RekaComboboxItemIndicator,
  ComboboxRoot as RekaComboboxRoot,
  ComboboxViewport as RekaComboboxViewport,
} from 'reka-ui';
import type { HTMLAttributes } from 'vue';
import { nextTick, ref, watch } from 'vue';

import Input from '~/components/form/Input.vue';
import { cn } from '~/utils/cn';

defineOptions({ inheritAttrs: false });

export interface ComboboxOption {
  value: string;
  label: string;
  description?: string;
  meta?: string;
}

interface ComboboxProps {
  options?: readonly ComboboxOption[];
  modelValue?: string | null;
  searchTerm?: string;
  placeholder?: string;
  loading?: boolean;
  inputId?: string;
  inputAriaLabel?: string;
  inputClass?: HTMLAttributes['class'];
  contentClass?: HTMLAttributes['class'];
  class?: HTMLAttributes['class'];
  size?: 'default' | 'lg';
}

const props = withDefaults(defineProps<ComboboxProps>(), {
  options: () => [],
  placeholder: 'Search an npm package to check for updates',
  loading: false,
  inputAriaLabel: 'Search npm packages',
  size: 'lg',
});

const emit = defineEmits<{
  'update:modelValue': [value: string | null];
  'update:searchTerm': [value: string];
  search: [value: string];
  select: [option: ComboboxOption];
}>();

const selectedValue = ref<string | null>(props.modelValue ?? null);
const searchTerm = ref(props.searchTerm ?? '');
const open = ref(false);
let skipNextSearchTermChange = false;

watch(
  () => props.modelValue,
  (value) => {
    selectedValue.value = value ?? null;
  },
);

watch(
  () => props.searchTerm,
  (value) => {
    if (value !== undefined && value !== searchTerm.value) {
      searchTerm.value = value;
    }
  },
);

watch(searchTerm, (value) => {
  if (skipNextSearchTermChange) {
    skipNextSearchTermChange = false;
    open.value = false;
    return;
  }

  emit('update:searchTerm', value);
  emit('search', value);
  open.value = value.trim().length > 0;
});

watch(
  () => props.options.length,
  (length) => {
    if (length > 0 && searchTerm.value.trim()) {
      open.value = true;
    }
  },
);

const handleSelectedValue = (value: string) => {
  const option = props.options.find((item) => item.value === value);
  const nextSearchTerm = option?.label ?? value;

  selectedValue.value = value;
  if (searchTerm.value !== nextSearchTerm) {
    skipNextSearchTermChange = true;
    searchTerm.value = nextSearchTerm;
  }
  open.value = false;
  emit('update:modelValue', value);

  if (option) {
    emit('select', option);
  }

  void nextTick(() => {
    open.value = false;
  });
};
</script>

<template>
  <RekaComboboxRoot
    v-bind="$attrs"
    v-model:open="open"
    :model-value="selectedValue"
    :open-on-focus="true"
    :open-on-click="true"
    :ignore-filter="true"
    :reset-search-term-on-blur="false"
    :reset-search-term-on-select="false"
    :class="cn('w-full', props.class)"
    @update:model-value="handleSelectedValue"
  >
    <RekaComboboxAnchor class="relative block w-full">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.75"
        class="pointer-events-none absolute left-4 top-1/2 z-10 size-5 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="6.5" />
        <path d="m16 16 4 4" stroke-linecap="round" />
      </svg>

      <RekaComboboxInput as-child v-model="searchTerm">
        <Input
          :id="props.inputId"
          type="search"
          :size="props.size"
          :placeholder="props.placeholder"
          :aria-label="props.inputAriaLabel"
          :class="cn('pl-12', props.inputClass)"
        />
      </RekaComboboxInput>
    </RekaComboboxAnchor>

    <RekaComboboxContent
      position="popper"
      :side-offset="6"
      :hide-when-empty="!props.loading"
      :class="
        cn(
          'z-50 max-h-80 w-[var(--reka-combobox-trigger-width)] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg',
          props.contentClass,
        )
      "
    >
      <RekaComboboxViewport class="max-h-80 overflow-y-auto">
        <RekaComboboxEmpty v-if="props.loading" class="px-3 py-4 text-sm text-muted-foreground">
          Searching npm…
        </RekaComboboxEmpty>

        <RekaComboboxItem
          v-for="option in props.options"
          :key="option.value"
          :value="option.value"
          :text-value="option.label"
          class="relative flex w-full cursor-default select-none items-start gap-3 rounded-lg px-3 py-3 text-left outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
        >
          <RekaComboboxItemIndicator class="mt-0.5 text-primary">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" class="size-4">
              <path d="m4 10 4 4 8-8" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </RekaComboboxItemIndicator>
          <span class="min-w-0 flex-1">
            <span class="flex items-baseline gap-2">
              <span class="truncate text-sm font-medium">{{ option.label }}</span>
              <span v-if="option.meta" class="shrink-0 text-xs text-muted-foreground">{{ option.meta }}</span>
            </span>
            <span v-if="option.description" class="mt-1 block truncate text-xs text-muted-foreground">
              {{ option.description }}
            </span>
          </span>
        </RekaComboboxItem>
      </RekaComboboxViewport>
    </RekaComboboxContent>
  </RekaComboboxRoot>
</template>
