import type { H3Event } from 'h3';
import { defineNitroPlugin, useRuntimeConfig } from 'nitropack/runtime';

import { applyResponseIndexingPolicy } from './_internals/responseIndexingPolicy';

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('beforeResponse', (event: H3Event) => {
    applyResponseIndexingPolicy(event, useRuntimeConfig(event).indexingEnabled === true);
  });
});
