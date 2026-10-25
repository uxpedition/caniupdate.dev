import { mockEvent } from 'h3';
import { describe, expect, it, vi } from 'vitest';

import handler from './[packageName].get';

function request(from: string, to: string, packageName = '@scope/example') {
  const event = mockEvent(
    `http://localhost/resolve/${encodeURIComponent(packageName)}?${new URLSearchParams({ from, to })}`,
  );

  event.context.params = { packageName: encodeURIComponent(packageName) };

  const metadata = vi.fn().mockResolvedValue({
    name: packageName,
    modified: '2026-10-01',
    distTags: {},
    versions: ['3.0.0-beta.2', '3.0.0-beta.1', '2.8.0', '2.1.0', '1.9.0', '1.2.3'],
  });

  Object.assign(event, { $fetch: metadata });

  return { event, metadata };
}

describe('explicit dependency resolution', () => {
  it.each([
    ['1.x', '*', '1.2.3...1.2.3'],
    ['>=2 <3 || ^1.9', '>=2 <3', '1.9.0...2.1.0'],
    ['2.x', '1.x', '2.1.0...1.2.3'],
    ['>=3.0.0-beta.1 <3.0.0', '3.0.0-beta.2', '3.0.0-beta.1...3.0.0-beta.2'],
  ])('resolves %s → %s from published releases, preserving order', async (from, to, pair) => {
    const { event, metadata } = request(from, to);
    const response = await handler(event);
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(`/%40scope%2Fexample/${pair}`);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(metadata).toHaveBeenCalledWith('/api/package/%40scope%2Fexample', { retry: 0 });
  });

  it('distinguishes a missing match from temporary metadata failure, without retries', async () => {
    const missing = request('9.x', '*');
    await expect(handler(missing.event)).rejects.toMatchObject({ statusCode: 404 });
    expect(missing.metadata).toHaveBeenCalledTimes(1);
    const unavailable = request('1.x', '2.x');
    unavailable.metadata.mockRejectedValue(new Error('private-upstream-marker'));
    const failure = handler(unavailable.event);
    await expect(failure).rejects.toMatchObject({ statusCode: 503 });
    await failure.catch((cause: unknown) => expect(JSON.stringify(cause)).not.toContain('private-upstream-marker'));
    expect(unavailable.metadata).toHaveBeenCalledTimes(1);
  });

  it('rejects empty selectors before metadata requests', async () => {
    const { event, metadata } = request('', '2.x');
    await expect(handler(event)).rejects.toMatchObject({ statusCode: 400 });
    expect(metadata).not.toHaveBeenCalled();
  });

  it('rejects malformed or wrong-package metadata rather than claiming no matches', async () => {
    const { event, metadata } = request('1.x', '2.x');
    metadata.mockResolvedValue({ name: 'other', versions: ['1.2.3', '2.1.0'] });
    await expect(handler(event)).rejects.toMatchObject({ statusCode: 503 });
  });
});
