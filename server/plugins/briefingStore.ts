import { defineNitroPlugin } from 'nitropack/runtime';

import { closeBriefingStore } from '../utils/packageBriefingStore';

export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook('close', closeBriefingStore);
});
