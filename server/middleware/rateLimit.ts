import { defineEventHandler } from 'h3';

import { admitPublicRequest } from '../request/rateLimit';

export default defineEventHandler(async (event) => {
  await admitPublicRequest(event);
});
