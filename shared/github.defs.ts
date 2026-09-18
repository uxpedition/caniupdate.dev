export type PackageRelease = {
  version: string;
  tag: string;
  name: string | null;
  body: string;
  url: string;
};

export type PackageChangelog = {
  body: string;
  url: string;
  path: string;
  ref: string;
};

export type PackageReleaseNotes = {
  status: 'available' | 'partial' | 'unavailable';
  reasons: readonly string[];
  releases: readonly PackageRelease[];
  changelog: PackageChangelog | null;
};
