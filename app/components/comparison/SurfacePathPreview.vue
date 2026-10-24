<script setup lang="ts">
import { X } from '@lucide/vue';
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui';
import { computed, nextTick, onBeforeUnmount, ref } from 'vue';

import type { SurfaceEntry } from './packageSurface.defs';

const props = defineProps<{ entry: SurfaceEntry; side: 'from' | 'to'; version: string }>();

const details = computed(() => props.entry[props.side]);

const previewKey = computed(() => `${props.side}:${props.version}:${props.entry.path}`);

const open = ref(false);

let closeTimer: ReturnType<typeof setTimeout> | undefined;

let trigger: HTMLElement | undefined;

let restoringFocus = false;

const cancelClose = () => {
  clearTimeout(closeTimer);
};

const show = (event: Event) => {
  if (restoringFocus) return;

  if (event.currentTarget instanceof HTMLElement) trigger = event.currentTarget;
  cancelClose();
  open.value = true;
};

const focusPreview = async (event: KeyboardEvent) => {
  show(event);
  await nextTick();
  const id = trigger?.getAttribute('aria-controls');

  if (id) document.getElementById(id)?.focus();
};

const closePreview = () => {
  open.value = false;
  restoringFocus = true;
  trigger?.focus();
  restoringFocus = false;
};

const scheduleClose = () => {
  cancelClose();
  closeTimer = setTimeout(() => {
    const focusedPreview = document.activeElement?.closest('[data-surface-preview]');

    if (focusedPreview?.getAttribute('data-surface-preview') !== previewKey.value) open.value = false;
  }, 150);
};

const showOnHover = (event: PointerEvent) => {
  if (event.pointerType !== 'touch') show(event);
};

const closeOnHoverLeave = (event: PointerEvent) => {
  if (event.pointerType !== 'touch') scheduleClose();
};

const interactWithPreview = (event: PointerEvent) => {
  cancelClose();

  if (event.pointerType === 'touch' && event.currentTarget instanceof HTMLElement)
    event.currentTarget.focus({ preventScroll: true });
};

onBeforeUnmount(cancelClose);
</script>

<template>
  <PopoverRoot v-model:open="open">
    <PopoverTrigger
      type="button"
      :aria-label="`Loading details for ${props.entry.path} in ${version}`"
      aria-description="Press Arrow Down to focus and scroll the preview."
      class="cursor-help text-left font-mono text-xs underline decoration-dotted decoration-muted-foreground/60 underline-offset-4 wrap-anywhere hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
      @pointerenter="showOnHover"
      @pointerleave="closeOnHoverLeave"
      @focus="show"
      @blur="scheduleClose"
      @click.capture.stop.prevent="show"
      @keydown.esc="closePreview"
      @keydown.down.prevent="focusPreview"
    >
      {{ entry.path }}
    </PopoverTrigger>
    <PopoverPortal>
      <PopoverContent
        :data-surface-preview="previewKey"
        tabindex="-1"
        side="top"
        :side-offset="8"
        :collision-padding="12"
        :aria-label="`Loading details for ${entry.path} in ${version}`"
        class="z-50 max-h-[min(640px,var(--reka-popover-content-available-height))] w-[min(420px,calc(100vw-24px))] overflow-auto rounded-md border border-border bg-background p-4 font-body text-xs leading-relaxed text-foreground shadow-lg"
        @open-auto-focus.prevent
        @close-auto-focus.prevent
        @escape-key-down="closePreview"
        @pointerenter="cancelClose"
        @pointerleave="closeOnHoverLeave"
        @pointerdown="interactWithPreview"
        @focusin="cancelClose"
        @focusout="scheduleClose"
      >
        <div class="mb-3 flex items-start justify-between gap-3">
          <h4 class="font-mono text-sm font-medium wrap-anywhere">{{ entry.path }}</h4>
          <button
            type="button"
            aria-label="Close loading preview"
            class="shrink-0 rounded p-1 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
            @click="closePreview"
          >
            <X :size="14" />
          </button>
        </div>
        <p v-if="entry.kind === 'pattern'" class="mb-3 text-muted-foreground">
          Path pattern, not a literal import. Matching files have not been checked.
        </p>
        <p class="mb-3 border-b border-border pb-2 font-mono">{{ version }}</p>
        <section class="min-w-0">
          <div v-for="mode in ['import', 'require'] as const" :key="mode" class="mb-4">
            <p class="mb-1 flex flex-wrap justify-between gap-1">
              <strong>{{ mode === 'import' ? 'import · ES modules' : 'require() · CommonJS' }}</strong
              ><span class="text-muted-foreground">{{ details[mode].label }}</span>
            </p>
            <pre
              v-if="details[mode].example"
              class="mb-2 rounded bg-muted p-2 font-mono whitespace-pre-wrap wrap-anywhere"
              >{{ details[mode].example }}</pre>
            <p class="text-muted-foreground">{{ details[mode].detail }}</p>
            <ol v-if="details[mode].branches.length" class="mt-2 space-y-1 border-l border-border pl-2">
              <li v-for="(branch, branchIndex) in details[mode].branches" :key="branchIndex" class="wrap-anywhere">
                <span class="text-muted-foreground">{{ branch.conditions.join(' → ') || 'All loading styles' }}</span
                ><br /><code>{{ branch.target === null ? 'Blocked (null)' : branch.target }}</code>
              </li>
            </ol>
          </div>
          <strong>TypeScript types</strong>
          <ul v-if="details.types.length" class="mt-1 space-y-1">
            <li v-for="(branch, index) in details.types" :key="index" class="wrap-anywhere">
              <span class="text-muted-foreground">{{ branch.conditions.join(' → ') }}</span
              ><br /><code>{{ branch.target ?? 'Blocked (null)' }}</code>
            </li>
          </ul>
          <p v-else class="mt-1 text-muted-foreground">
            No type entry established for this path from these declarations. This does not prove types are missing.
          </p>
        </section>
        <p class="mt-3 border-t border-border pt-3 text-muted-foreground">
          Declarations only. Conditions and fallbacks are listed in package order, not resolved for your project.
        </p>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
