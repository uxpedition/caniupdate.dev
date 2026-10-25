import { describe, expect, it } from 'vitest';

import { installSourceLink } from './installScripts';

describe('install source links', () => {
  it('preserves scoped package routing and encodes file segments without losing the line', () => {
    expect(installSourceLink('@example/widget', '1.2.3-beta.1', 'scripts/install #1.js', 42)).toBe(
      'https://npmx.dev/package-code/%40example/widget/v/1.2.3-beta.1/scripts/install%20%231.js#L42',
    );
  });

  it('does not let a literal percent escape turn into a different source path', () => {
    expect(installSourceLink('widget', '1.0.0', 'lib/file%2Fname.js', 7)).toBe(
      'https://npmx.dev/package-code/widget/v/1.0.0/lib/file%252Fname.js#L7',
    );
  });
});
