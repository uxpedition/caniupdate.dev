import { getRequestURL, getResponseHeader, getResponseStatus, setResponseHeader } from 'h3';
import type { H3Event } from 'h3';

import { INDEXABLE_STATIC_PATHS } from '#shared/site/discovery';

/** A deployment opt-in and useful SSR facts are independent requirements; headers survive all page head owners. */
export const applyResponseIndexingPolicy = (event: H3Event, indexingEnabled: boolean): void => {
  const successfulHtml =
    getResponseStatus(event) === 200 &&
    getResponseHeader(event, 'content-type')?.toLowerCase().startsWith('text/html') === true;

  const eligible =
    indexingEnabled &&
    successfulHtml &&
    (INDEXABLE_STATIC_PATHS.includes(getRequestURL(event).pathname) || event.context.comparisonIndexable === true);

  // Non-HTML failures and redirects also stay out of discovery; noindex never replaces access controls.
  if (!eligible) setResponseHeader(event, 'X-Robots-Tag', 'noindex, follow');
};
