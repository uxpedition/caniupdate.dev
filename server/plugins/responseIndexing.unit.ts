import { getResponseHeader, mockEvent, setResponseHeader, setResponseStatus } from 'h3';
import { describe, expect, it } from 'vitest';

import { applyResponseIndexingPolicy } from './_internals/responseIndexingPolicy';

const response = (path: string, status = 200, contentType = 'text/html') => {
  const event = mockEvent(`https://caniupdate.dev${path}`);
  setResponseStatus(event, status);
  setResponseHeader(event, 'content-type', contentType);

  return event;
};

describe('search indexing response boundaries', () => {
  it('does not let a production-looking host or reviewed comparison override nonproduction policy', () => {
    const event = response('/chalk/4.1.2...5.0.0');
    event.context.comparisonIndexable = true;

    applyResponseIndexingPolicy(event, false);

    expect(getResponseHeader(event, 'x-robots-tag')).toBe('noindex, follow');
  });

  it.each([301, 302, 400, 404, 429, 503])('denies status %s even with eligible comparison evidence', (status) => {
    const event = response('/chalk/4.1.2...5.0.0', status);
    event.context.comparisonIndexable = true;

    applyResponseIndexingPolicy(event, true);

    expect(getResponseHeader(event, 'x-robots-tag')).toBe('noindex, follow');
  });

  it('does not index JSON errors or let successful non-HTML responses count as facts', () => {
    const event = response('/chalk/4.1.2...5.0.0', 200, 'application/json');
    event.context.comparisonIndexable = true;

    applyResponseIndexingPolicy(event, true);

    expect(getResponseHeader(event, 'x-robots-tag')).toBe('noindex, follow');
  });

  it('preserves a stricter route-owned robots policy on otherwise eligible HTML', () => {
    const event = response('/about');
    setResponseHeader(event, 'x-robots-tag', 'noindex, nofollow');

    applyResponseIndexingPolicy(event, true);

    expect(getResponseHeader(event, 'x-robots-tag')).toBe('noindex, nofollow');
  });
});
