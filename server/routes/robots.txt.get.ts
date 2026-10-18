import { defineEventHandler, setResponseHeader } from 'h3';

import { useRuntimeConfig } from '#imports';
import { renderRobots } from '#shared/site/discovery';

export default defineEventHandler((event) => {
  const config = useRuntimeConfig(event);
  setResponseHeader(event, 'Content-Type', 'text/plain; charset=utf-8');
  setResponseHeader(event, 'Cache-Control', 'no-store');

  return renderRobots(config.public.siteUrl, config.indexingEnabled === true);
});
