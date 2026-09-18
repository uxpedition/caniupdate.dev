export type PublishedFile = {
  path: string;
  type: 'file' | 'directory' | 'symlink' | 'link';
  size: number;
  sha256: string | null;
  linkTarget?: string;
};

export type ShippedChangelog = {
  path: string;
  body: string;
  truncated: boolean;
};

export type PackageTarball = {
  status: 'available' | 'partial' | 'unavailable';
  reasons: readonly string[];
  url: string;
  files: readonly PublishedFile[];
  changelogs: readonly ShippedChangelog[];
};
