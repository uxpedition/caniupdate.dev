import { defineEventHandler, setResponseHeader } from 'h3';

import { useRuntimeConfig } from '#imports';
import { renderSitemap } from '#shared/site/discovery';

export default defineEventHandler((event) => {
  const config = useRuntimeConfig(event);
  setResponseHeader(event, 'Content-Type', 'application/xml; charset=utf-8');
  setResponseHeader(event, 'Cache-Control', 'no-store');

  return renderSitemap(config.public.siteUrl, config.indexingEnabled === true);
});
