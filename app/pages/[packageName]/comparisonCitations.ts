/**
 * The anchor a citation jumps to. Computed comparison facts are anchored by the comparison row that renders them
 * (`comparison.node` → `comparison-node`), every other source by its own evidence row.
 */
export function citationAnchorId(sourceId: string): string {
  const normalized = sourceId
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return sourceId.startsWith('comparison.') ? normalized : `evidence-${normalized}`;
}
