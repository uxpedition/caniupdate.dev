import type { DehydratedState } from '@tanstack/vue-query';
import { dehydrate, hydrate, QueryClient, VueQueryPlugin } from '@tanstack/vue-query';

import { defineNuxtPlugin, useState } from '#imports';

export default defineNuxtPlugin((nuxtApp) => {
  const vueQueryState = useState<DehydratedState | null>('vue-query', () => null);
  const queryClient = new QueryClient();

  nuxtApp.vueApp.use(VueQueryPlugin, { queryClient });

  if (import.meta.server) {
    nuxtApp.hooks.hook('app:rendered', () => {
      vueQueryState.value = dehydrate(queryClient);
    });
  } else if (vueQueryState.value !== null) {
    hydrate(queryClient, vueQueryState.value);
  }
});
