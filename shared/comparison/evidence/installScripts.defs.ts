import { Array, Iterable, Option, Schema } from 'effect';

import { PackageNameSchema } from '../package/package.defs';

const BoundedText = Schema.String.check(Schema.isMaxLength(4096));

const SourcePath = Schema.String.check(
  Schema.isMaxLength(4096),
  Schema.makeFilter(
    (path: string) =>
      Option.isNone(
        Iterable.findFirst(path, (character) => {
          const code = character.charCodeAt(0);

          return code <= 0x1f || code === 0x7f || character === '\\';
        }),
      ) && Array.every(path.split('/'), (part) => part !== '' && part !== '.' && part !== '..'),
    { expected: 'a package-relative source path' },
  ),
);

const Line = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

const Status = Schema.Literals(['available', 'partial', 'unavailable']);

export const InstallFindingSchema = Schema.Struct({
  script: BoundedText,
  kind: Schema.Literals([
    'network',
    'process',
    'file-read',
    'file-open',
    'file-write',
    'file-delete',
    'environment',
    'dynamic-code',
    'native-build',
  ]),
  path: SourcePath,
  line: Line,
  endLine: Line,
  excerpt: Schema.String.check(Schema.isMaxLength(600)),
  detail: BoundedText,
});

export type InstallFinding = typeof InstallFindingSchema.Type;

export const InstallAnalysisSchema = Schema.Struct({
  status: Status,
  reasons: Schema.Array(BoundedText).check(Schema.isMaxLength(32)),
  uninspectedPackages: Schema.Array(PackageNameSchema).check(Schema.isMaxLength(64)),
  scripts: Schema.Array(
    Schema.Struct({
      name: BoundedText,
      command: BoundedText,
      origin: Schema.Literals(['declared', 'implicit']),
      files: Schema.Array(SourcePath).check(Schema.isMaxLength(64)),
    }),
  ).check(Schema.isMaxLength(16)),
  findings: Schema.Array(InstallFindingSchema).check(Schema.isMaxLength(64)),
});

export type InstallAnalysis = typeof InstallAnalysisSchema.Type;

/** Private fingerprints for only the files reached from installation commands. */
export const InstallInspectionSchema = Schema.Struct({
  analysis: InstallAnalysisSchema,
  files: Schema.Array(
    Schema.Struct({
      path: SourcePath,
      sha256: Schema.String,
    }),
  ).check(Schema.isMaxLength(64)),
});

export type InstallInspection = typeof InstallInspectionSchema.Type;

export const InstallImplementationComparisonSchema = Schema.Struct({
  status: Status,
  changedFiles: Schema.Array(SourcePath).check(Schema.isMaxLength(128)),
});

export type InstallImplementationComparison = typeof InstallImplementationComparisonSchema.Type;
