import { describe, expect, it } from 'vitest';

import { citationAnchorId } from './comparisonCitations';

describe('citationAnchorId', () => {
  it('creates stable, readable anchors for evidence IDs', () => {
    expect(citationAnchorId('comparison.sizes')).toBe('comparison-sizes');
    expect(citationAnchorId('maintainer.19.3.0')).toBe('evidence-maintainer-19-3-0');
  });
});
