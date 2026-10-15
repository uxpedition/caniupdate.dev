import { createError } from 'h3';
import type { H3Event } from 'h3';

import type { BriefingServiceBinding } from '#shared/cloudflare';
import type { BriefingEvidence } from '#shared/comparison/briefing/briefing.defs';
import { decodeStoredBriefingResult } from '#shared/comparison/briefing/storedBriefing.defs';
import type { StoredBriefingResult } from '#shared/comparison/briefing/storedBriefing.defs';

import { getBriefingEvidence, PackageEvidenceClientError } from '../../_internals/evidenceClient';
import { receiveServiceRpcResult } from './serviceRpc';

type ComparisonIdentity = { readonly packageName: string; readonly from: string; readonly to: string };

const unavailable = () => createError({ statusCode: 503, statusMessage: 'Briefing service unavailable' });

const matchesIdentity = (stored: StoredBriefingResult, identity: ComparisonIdentity): boolean =>
  stored.packageName === identity.packageName && stored.from === identity.from && stored.to === identity.to;

const readStoredResult = async (
  service: BriefingServiceBinding,
  evidence: BriefingEvidence,
): Promise<StoredBriefingResult> => {
  try {
    return await receiveServiceRpcResult(() => service.read(evidence), decodeStoredBriefingResult);
  } catch {
    throw unavailable();
  }
};

/** Rebuild the exact evidence identity and read only its validated D1 success row. */
export const getStoredBriefing = async (
  event: H3Event,
  identity: ComparisonIdentity,
): Promise<StoredBriefingResult> => {
  let evidence: BriefingEvidence;

  try {
    evidence = await getBriefingEvidence(event.context.cloudflare?.env?.PACKAGE_EVIDENCE, identity);
  } catch (error) {
    if (error instanceof PackageEvidenceClientError) {
      throw createError({ statusCode: 503, statusMessage: 'Evidence service unavailable' });
    }

    throw error;
  }

  const service: BriefingServiceBinding | undefined = event.context.cloudflare?.env?.BRIEFING_SERVICE;

  if (service === undefined) throw unavailable();

  const stored = await readStoredResult(service, evidence);

  if (!matchesIdentity(stored, identity)) {
    throw unavailable();
  }

  return stored;
};
