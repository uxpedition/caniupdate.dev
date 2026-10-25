import { Effect, Ref } from 'effect';

import type { PublishedFile } from '../../../shared/comparison/evidence/tarball.defs';

/** Source bytes exist only while inspecting this archive; never part of the cached value. */
export class ArchiveSources {
  readonly files = new Map<string, string>();
  private readonly budget = Ref.makeUnsafe({ reserved: 0, count: 0 });
  private readonly selected = new Set<string>();

  readonly allowance = Effect.fnUntraced(function* (
    this: ArchiveSources,
    file: PublishedFile,
  ): Effect.fn.Return<number> {
    if (file.type !== 'file' || !/\.(?:[cm]?js|json|gyp)$/.test(file.path)) return 0;

    const accepted = yield* Ref.modify(this.budget, (budget) =>
      file.size > 256 * 1024 || budget.reserved + file.size > 2 * 1024 * 1024 || budget.count >= 128
        ? [false, budget]
        : [true, { reserved: budget.reserved + file.size, count: budget.count + 1 }],
    );

    if (!accepted) return 0;
    this.selected.add(file.path);

    return file.size;
  });

  readonly capture = Effect.fnUntraced(function* (
    this: ArchiveSources,
    file: PublishedFile,
    text: Uint8Array,
  ): Effect.fn.Return<void> {
    if (!this.selected.has(file.path) || text.length !== file.size) return;
    yield* Effect.try(() => new TextDecoder('utf-8', { fatal: true }).decode(text)).pipe(
      Effect.map((source) => {
        this.files.set(file.path, source);
      }),
      // A reached file without complete UTF-8 text becomes an explicit analysis gap.
      Effect.catch(() => Effect.void),
    );
  });
}
