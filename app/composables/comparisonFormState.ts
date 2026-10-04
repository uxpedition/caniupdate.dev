export interface ComparisonFormDraft {
  searchTerm: string;
  selectedPackage: string | null;
  fromVersionSelection: string | null;
  toVersionSelection: string | null;
}

export interface ComparisonRouteIdentity {
  packageName: string;
  fromVersion: string;
  toVersion: string;
}

export interface FormBounds {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface ComparisonFormRelocation {
  id: number;
  targetPath: string;
  source: FormBounds;
}

export const emptyComparisonFormDraft = (): ComparisonFormDraft => ({
  searchTerm: '',
  selectedPackage: null,
  fromVersionSelection: null,
  toVersionSelection: null,
});

export const comparisonPath = ({ packageName, fromVersion, toVersion }: ComparisonRouteIdentity): string =>
  `/${encodeURIComponent(packageName)}/${fromVersion}...${toVersion}`;

export const resetComparisonFormDraft = (draft: ComparisonFormDraft): void => {
  draft.fromVersionSelection = null;
  draft.toVersionSelection = null;
  draft.selectedPackage = null;
  draft.searchTerm = '';
};
