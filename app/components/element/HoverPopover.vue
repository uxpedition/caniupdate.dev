<script setup lang="ts">
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui';
import { onBeforeUnmount, ref } from 'vue';

defineProps<{ label: string }>();

const open = defineModel<boolean>('open', { required: true });

const openedByHover = ref(false);

let closeTimer: ReturnType<typeof setTimeout> | undefined;

const cancelClose = () => {
  clearTimeout(closeTimer);
  closeTimer = undefined;
};

const showOnHover = (event: PointerEvent) => {
  if (event.pointerType === 'touch') return;

  cancelClose();

  if (open.value) return;
  openedByHover.value = true;
  open.value = true;
};

const setOpen = (value: boolean) => {
  cancelClose();
  openedByHover.value = false;
  open.value = value;
};

const scheduleClose = () => {
  cancelClose();

  if (!openedByHover.value) return;

  closeTimer = setTimeout(() => {
    open.value = false;
    closeTimer = undefined;
  }, 150);
};

onBeforeUnmount(cancelClose);
</script>

<template>
  <PopoverRoot :open="open" @update:open="setOpen">
    <PopoverTrigger
      type="button"
      class="cursor-help underline decoration-dotted underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      @pointerenter="showOnHover"
      @pointerleave="scheduleClose"
    >
      <slot name="trigger" />
    </PopoverTrigger>
    <PopoverPortal>
      <PopoverContent
        side="top"
        :side-offset="6"
        :collision-padding="12"
        :aria-label="label"
        @open-auto-focus="openedByHover && $event.preventDefault()"
        @close-auto-focus="openedByHover && $event.preventDefault()"
        @pointerenter="cancelClose"
        @pointerleave="scheduleClose"
        @focusin="
          openedByHover = false;
          cancelClose();
        "
        class="z-50 max-w-[min(480px,calc(100vw-24px))] rounded-md border border-neutral-300 bg-neutral-100 px-3 py-2 font-body text-xs leading-relaxed text-neutral-900 shadow-lg"
      >
        <slot />
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
