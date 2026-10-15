export type BuildIdentity =
  | { readonly commitSha: null; readonly repositoryUrl: null }
  | { readonly commitSha: string; readonly repositoryUrl: string };

const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/;

const isRepositoryOrigin = (url: URL): boolean =>
  url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash;

const parseRepositoryUrl = (value: string): string => {
  if (value !== value.trim()) {
    throw new Error('NUXT_BUILD_REPOSITORY_URL must be an HTTPS GitLab project URL.');
  }

  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error('NUXT_BUILD_REPOSITORY_URL must be an HTTPS GitLab project URL.');
  }

  const projectPath = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname;
  const projectSegments = projectPath.split('/').slice(1);

  if (
    !isRepositoryOrigin(url) ||
    projectSegments.length < 2 ||
    projectSegments.some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error('NUXT_BUILD_REPOSITORY_URL must be an HTTPS GitLab project URL.');
  }

  return `${url.origin}${projectPath}`;
};

export const parseBuildIdentity = (commitSha: string | undefined, repositoryUrl: string | undefined): BuildIdentity => {
  const hasCommitSha = commitSha !== undefined && commitSha !== '';
  const hasRepositoryUrl = repositoryUrl !== undefined && repositoryUrl !== '';

  if (!hasCommitSha && !hasRepositoryUrl) {
    return { commitSha: null, repositoryUrl: null };
  }

  if (!hasCommitSha || !hasRepositoryUrl) {
    throw new Error('NUXT_BUILD_COMMIT_SHA and NUXT_BUILD_REPOSITORY_URL must be configured together.');
  }

  if (!COMMIT_SHA_PATTERN.test(commitSha)) {
    throw new Error('NUXT_BUILD_COMMIT_SHA must be a full 40-character lowercase hexadecimal commit SHA.');
  }

  return { commitSha, repositoryUrl: parseRepositoryUrl(repositoryUrl) };
};
