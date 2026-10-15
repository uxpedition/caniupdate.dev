import { getRequestURL } from 'h3';
import { defineNitroPlugin } from 'nitropack/runtime';

import { applyResponseCachePolicy } from './_internals/responseCachePolicy';

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('render:route', (renderContext, { event }) => {
    // Buffer non-home HTML until any route-specific SSR cache eligibility is known before the response is sent.
    if (getRequestURL(event).pathname !== '/') renderContext.prefersStream = false;
  });

  nitroApp.hooks.hook('beforeResponse', applyResponseCachePolicy);
});
