import { Function, Schema } from 'effect';

const STABLE_VERSION_PATTERN = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?![\s\S])/;

const SHA_PATTERN = /^[0-9a-f]{40}(?![\s\S])/;

const PIPELINE_ID_PATTERN = /^[1-9][0-9]*(?![\s\S])/;

export const StableReleaseVersionSchema = Schema.String.check(Schema.isPattern(STABLE_VERSION_PATTERN));

export const isStableReleaseVersion = Schema.is(StableReleaseVersionSchema);

export const ReleaseTagReceiptSchema = Schema.Struct({
  version: StableReleaseVersionSchema,
  tag: Schema.String,
  commitSha: Schema.String.check(Schema.isPattern(SHA_PATTERN)),
  pipelineId: Schema.String.check(Schema.isPattern(PIPELINE_ID_PATTERN)),
});

export type ReleaseTagReceipt = typeof ReleaseTagReceiptSchema.Type;

export const decodeReleaseTagReceipt = Function.flow(
  Schema.decodeUnknownSync(ReleaseTagReceiptSchema, {
    errors: 'all',
    onExcessProperty: 'ignore',
  }),
  (receipt): ReleaseTagReceipt => {
    if (receipt.tag !== `v${receipt.version}`) throw new Error('Release receipt tag does not match its version');

    return receipt;
  },
);
