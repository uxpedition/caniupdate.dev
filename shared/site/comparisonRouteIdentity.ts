const TRACKING_PARAMETERS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'gclid',
  'dclid',
  'fbclid',
  'msclkid',
] as const;

/** Unknown parameters may change page meaning; only known tracking fields are omitted. */
export const substantiveSearch = (search: string): string => {
  const params = new URLSearchParams(search.split('#', 1)[0]);

  for (const key of TRACKING_PARAMETERS) params.delete(key);

  const remaining = params.toString();

  return remaining === '' ? '' : `?${remaining}`;
};

// Vue Router keeps a scoped name's @ literal in the address bar; encode its slash exactly once.
export const comparisonIdentityPath = (packageName: string, from: string, to: string): string =>
  `/${encodeURIComponent(packageName).replace(/^%40/, '@')}/${encodeURIComponent(from)}...${encodeURIComponent(to)}`;

export const comparisonRedirect = (
  currentPath: string,
  packageName: string,
  requestedFrom: string,
  requestedTo: string,
  resolvedFrom: string,
  resolvedTo: string,
): { readonly path: string; readonly redirectCode: 301 | 302 } | undefined => {
  const path = comparisonIdentityPath(packageName, resolvedFrom, resolvedTo);

  if (currentPath === path) return undefined;

  return {
    path,
    redirectCode: requestedFrom === resolvedFrom && requestedTo === resolvedTo ? 301 : 302,
  };
};
