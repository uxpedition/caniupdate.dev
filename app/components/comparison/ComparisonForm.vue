<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import type { RouteLocationNormalized } from 'vue-router';

import { navigateTo, useRouter } from '#imports';
import Button from '~/components/element/Button.vue';
import Combobox from '~/components/form/Combobox.vue';
import Select from '~/components/form/Select.vue';
import {
  comparisonPath,
  resetComparisonFormDraft,
  type ComparisonFormRelocation,
  type FormBounds,
} from '~/composables/comparisonFormState';
import { useComparisonForm } from '~/composables/useComparisonForm';

const props = defineProps<{ variant: 'home' | 'header' }>();
const {
  draft,
  error,
  isError,
  isFetching,
  packageOptions,
  toVersionOptions,
  versionOptions,
  versionSearch,
  versionSelectDisabled,
  versionPlaceholder,
  selectedFromVersion,
  selectedToVersion,
  canCompare,
  isSubmitting,
  relocation,
  relocationSequence,
} = useComparisonForm();
const router = useRouter();
const formElement = ref<HTMLFormElement | null>(null);
const versionSelectAnchor = ref<HTMLElement | null>(null);
let animationFrame: number | undefined;
let animationTimer: number | undefined;
let removeFormNavigationGuard: (() => void) | undefined;

const clearFormAnimation = () => {
  const element = formElement.value;

  if (element !== null) {
    element.removeEventListener('transitionend', finishFormAnimation);
    element.classList.remove('comparison-form--moving');
    element.style.removeProperty('transition');
    element.style.removeProperty('transform');
    element.style.removeProperty('transform-origin');
    element.style.removeProperty('will-change');
  }

  if (animationFrame !== undefined) {
    window.cancelAnimationFrame(animationFrame);
    animationFrame = undefined;
  }

  if (animationTimer !== undefined) {
    window.clearTimeout(animationTimer);
    animationTimer = undefined;
  }
};

const finishFormAnimation = (event: TransitionEvent) => {
  if (event.propertyName === 'transform' && event.target === formElement.value) {
    clearFormAnimation();
  }
};

interface ComparisonSubmission {
  id: number;
  targetPath: string;
  source: FormBounds | null;
}

const getFormBounds = (): FormBounds | null => {
  const rect = formElement.value?.getBoundingClientRect();

  return rect === undefined ? null : { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
};

const createSubmission = (): ComparisonSubmission | null => {
  if (!canCompare.value || isSubmitting.value) {
    return null;
  }

  const packageName = draft.value.selectedPackage;
  const fromVersion = selectedFromVersion.value;
  const toVersion = selectedToVersion.value;

  if (packageName === null || fromVersion === null || toVersion === null) {
    return null;
  }

  return {
    id: ++relocationSequence.value,
    targetPath: comparisonPath({ packageName, fromVersion, toVersion }),
    source: props.variant === 'home' ? getFormBounds() : null,
  };
};

const clearRelocation = (submissionId: number) => {
  if (relocation.value?.id === submissionId) {
    relocation.value = null;
  }
};

const storeRelocation = ({ id, targetPath, source }: ComparisonSubmission) => {
  if (source !== null) {
    relocation.value = { id, targetPath, source };
  }
};

const completeSubmission = ({ id, targetPath }: ComparisonSubmission) => {
  if (router.currentRoute.value.path !== targetPath) {
    clearRelocation(id);
    return;
  }

  resetComparisonFormDraft(draft.value);
};

const submit = async () => {
  const submission = createSubmission();

  if (submission === null) {
    return;
  }

  isSubmitting.value = true;
  storeRelocation(submission);

  try {
    await navigateTo(submission.targetPath);
    completeSubmission(submission);
  } catch (error) {
    clearRelocation(submission.id);
    throw error;
  } finally {
    isSubmitting.value = false;
  }
};

const takePendingRelocation = (): ComparisonFormRelocation | null => {
  const pending = relocation.value;

  if (pending === null) {
    return null;
  }

  clearRelocation(pending.id);

  return pending.targetPath === router.currentRoute.value.path ? pending : null;
};

const createRelocationTransform = (element: HTMLFormElement, source: FormBounds): string | null => {
  const destination = element.getBoundingClientRect();

  if (destination.width === 0 || destination.height === 0) {
    return null;
  }

  const translateX = source.left - destination.left;
  const translateY = source.top - destination.top;
  const scaleX = source.width / destination.width;
  const scaleY = source.height / destination.height;

  return `translate3d(${translateX}px, ${translateY}px, 0) scale(${scaleX}, ${scaleY})`;
};

const startFormAnimation = (element: HTMLFormElement, transform: string) => {
  element.style.transition = 'none';
  element.style.transformOrigin = 'top left';
  element.style.transform = transform;
  element.style.willChange = 'transform, opacity';
  element.getBoundingClientRect();
  element.addEventListener('transitionend', finishFormAnimation);

  animationFrame = window.requestAnimationFrame(() => {
    animationFrame = undefined;
    element.classList.add('comparison-form--moving');
    element.style.removeProperty('transition');
    element.style.transform = 'translate3d(0, 0, 0) scale(1, 1)';
  });
  animationTimer = window.setTimeout(clearFormAnimation, 400);
};

const startFormRelocation = (pending: ComparisonFormRelocation) => {
  const element = formElement.value;

  if (element === null || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return;
  }

  const transform = createRelocationTransform(element, pending.source);

  if (transform !== null) {
    startFormAnimation(element, transform);
  }
};

const startPendingRelocation = () => {
  const pending = takePendingRelocation();

  if (pending !== null) {
    startFormRelocation(pending);
  }
};

const isComparisonRoute = (route: RouteLocationNormalized) =>
  typeof route.params.packageName === 'string' && typeof route.params.versionPair === 'string';

const shouldCaptureFormRelocation = (to: RouteLocationNormalized, from: RouteLocationNormalized) => {
  if (props.variant === 'home') {
    return from.path === '/' && isComparisonRoute(to) && relocation.value?.targetPath !== to.path;
  }

  return to.path === '/' && from.path !== '/';
};

onMounted(() => {
  removeFormNavigationGuard = router.beforeEach((to, from) => {
    if (!shouldCaptureFormRelocation(to, from)) {
      return;
    }

    const source = getFormBounds();

    if (source !== null) {
      relocation.value = { id: ++relocationSequence.value, targetPath: to.path, source };
    }
  });

  void nextTick(startPendingRelocation);
});

onBeforeUnmount(() => {
  removeFormNavigationGuard?.();
  clearFormAnimation();
});
</script>

<template>
  <form
    ref="formElement"
    role="search"
    aria-label="Search npm packages"
    class="comparison-form w-full"
    :class="
      variant === 'home'
        ? 'flex flex-col items-center gap-3'
        : 'grid min-w-0 grid-cols-1 items-end gap-x-3 gap-y-2 min-[901px]:grid-cols-[minmax(0,1.4fr)_minmax(0,1.6fr)_auto]'
    "
    @submit.prevent="submit"
  >
    <div
      :class="
        variant === 'home'
          ? 'min-w-0 w-full grid gap-3 lg:grid-cols-[minmax(0,1fr)_12rem_12rem] lg:items-start'
          : 'contents'
      "
    >
      <div class="min-w-0" :class="variant === 'home' ? '' : 'min-[901px]:col-start-1'">
        <div class="space-y-2" :class="variant === 'header' ? 'space-y-1' : ''">
          <label
            for="package-search"
            :class="
              variant === 'header'
                ? 'sr-only'
                : 'block text-xs font-medium uppercase tracking-wide text-muted-foreground'
            "
          >
            Package name
          </label>
          <Combobox
            input-id="package-search"
            input-aria-label="Search npm packages"
            placeholder="Search packages"
            data-testid="package-search"
            :options="packageOptions"
            :loading="isFetching"
            loading-text="Searching npm…"
            :size="variant === 'home' ? 'lg' : 'default'"
            :input-class="variant === 'header' ? 'pl-10' : undefined"
            v-model="draft.selectedPackage"
            v-model:search-term="draft.searchTerm"
            @search="draft.selectedPackage = null"
          />
        </div>
        <p v-if="isError" class="mt-2 text-sm text-destructive" aria-live="polite">
          {{ error?.message ?? 'Unable to search npm packages.' }}
        </p>
      </div>

      <div
        ref="versionSelectAnchor"
        :class="
          variant === 'home'
            ? 'grid gap-3 sm:grid-cols-2 lg:col-span-2'
            : 'grid min-w-0 grid-cols-2 gap-2 min-[901px]:col-start-2'
        "
      >
        <div :class="variant === 'header' ? 'min-w-0 space-y-1' : 'space-y-2'">
          <label
            for="from-version"
            :class="
              variant === 'header'
                ? 'sr-only'
                : 'block text-xs font-medium uppercase tracking-wide text-muted-foreground'
            "
          >
            From version
          </label>
          <Select
            trigger-id="from-version"
            data-testid="from-version"
            aria-label="From version"
            :anchor="versionSelectAnchor"
            :placeholder="versionPlaceholder"
            :size="variant === 'home' ? 'lg' : 'default'"
            :options="versionOptions"
            :search="versionSearch"
            :model-value="draft.fromVersionSelection"
            :disabled="versionSelectDisabled"
            @update:model-value="draft.fromVersionSelection = $event"
          />
        </div>

        <div :class="variant === 'header' ? 'min-w-0 space-y-1' : 'space-y-2'">
          <label
            for="to-version"
            :class="
              variant === 'header'
                ? 'sr-only'
                : 'block text-xs font-medium uppercase tracking-wide text-muted-foreground'
            "
          >
            To version
          </label>
          <Select
            trigger-id="to-version"
            data-testid="to-version"
            aria-label="To version"
            :anchor="versionSelectAnchor"
            :placeholder="versionPlaceholder"
            :size="variant === 'home' ? 'lg' : 'default'"
            :options="toVersionOptions"
            :search="versionSearch"
            :model-value="draft.toVersionSelection"
            :disabled="versionSelectDisabled"
            @update:model-value="draft.toVersionSelection = $event"
          />
        </div>
      </div>
      <Button
        v-if="variant === 'header'"
        data-testid="compare"
        type="submit"
        size="sm"
        class="h-10 w-full min-[901px]:col-start-3"
        :disabled="!canCompare || isSubmitting"
      >
        Compare versions
      </Button>
    </div>

    <p v-if="variant === 'home'" class="w-full text-center text-sm text-faded-foreground" aria-live="polite">
      Instant search, start typing to search package. Minimum 2 characters.
    </p>

    <Button
      v-if="variant === 'home'"
      data-testid="compare"
      type="submit"
      size="lg"
      class="mt-8 h-14 w-full max-w-64"
      :disabled="!canCompare || isSubmitting"
    >
      Compare versions
    </Button>
  </form>
</template>

<style>
.comparison-form--moving {
  transform-origin: top left;
  transition: transform 400ms cubic-bezier(0.2, 0.8, 0.2, 1);
  will-change: transform, opacity;
}

@media (prefers-reduced-motion: reduce) {
  .comparison-form--moving {
    transition: none !important;
  }
}
</style>
