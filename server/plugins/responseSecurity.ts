import { defineNitroPlugin } from 'nitropack/runtime';

import { applyResponseSecurityPolicy } from './_internals/responseSecurityPolicy';

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('beforeResponse', applyResponseSecurityPolicy);
});
