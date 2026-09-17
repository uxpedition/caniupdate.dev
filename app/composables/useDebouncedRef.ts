import { onScopeDispose, shallowRef, toValue, watch, type MaybeRefOrGetter, type Ref } from 'vue';

export const useDebouncedRef = <T>(source: MaybeRefOrGetter<T>, delayMs: number): Ref<T> => {
  const debouncedValue = shallowRef<T>(toValue(source));
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const stop = watch(
    () => toValue(source),
    (value) => {
      clearTimeout(timeout);

      timeout = setTimeout(() => {
        debouncedValue.value = value;
        timeout = undefined;
      }, delayMs);
    },
    { flush: 'sync' },
  );

  onScopeDispose(() => {
    stop();
    clearTimeout(timeout);
  });

  return debouncedValue;
};
