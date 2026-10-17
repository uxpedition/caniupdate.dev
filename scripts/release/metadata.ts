import { decodeReleaseTagReceipt, type ReleaseTagReceipt } from '../../shared/site/releaseIdentity.ts';
import { ReleaseAutomationFailure } from './version.ts';

function trailerValues(message: string, name: string): readonly string[] {
  const prefix = `${name}: `;

  return message
    .split('\n')
    .filter((line) => line.startsWith(prefix))
    .map((line) => line.slice(prefix.length));
}

export function releaseTagMessage(receipt: ReleaseTagReceipt): string {
  let verifiedReceipt: ReleaseTagReceipt;

  try {
    verifiedReceipt = decodeReleaseTagReceipt(receipt);
  } catch {
    throw new ReleaseAutomationFailure('Release tag metadata is invalid');
  }

  return [
    `Can I update release ${verifiedReceipt.tag}`,
    '',
    `Release-Version: ${verifiedReceipt.version}`,
    `Release-Tag: ${verifiedReceipt.tag}`,
    `Release-Commit: ${verifiedReceipt.commitSha}`,
    `Release-Pipeline: ${verifiedReceipt.pipelineId}`,
  ].join('\n');
}

export function releaseMetadataFromTagMessage(message: string | null): ReleaseTagReceipt | undefined {
  if (message === null) return undefined;

  try {
    const version = trailerValues(message, 'Release-Version');
    const tag = trailerValues(message, 'Release-Tag');
    const commitSha = trailerValues(message, 'Release-Commit');
    const pipelineId = trailerValues(message, 'Release-Pipeline');

    return decodeReleaseTagReceipt({
      version: version.length === 1 ? version[0] : undefined,
      tag: tag.length === 1 ? tag[0] : undefined,
      commitSha: commitSha.length === 1 ? commitSha[0] : undefined,
      pipelineId: pipelineId.length === 1 ? pipelineId[0] : undefined,
    });
  } catch {
    return undefined;
  }
}
