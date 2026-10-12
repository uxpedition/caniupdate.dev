import { computed, watch, type ComputedRef, type Ref } from 'vue';

import { useRouter, useState } from '#imports';
import { createSemverAtLeastPredicate } from '#shared/comparison/package/compareSemver';
import type { ParsedPackageMetadata } from '#shared/comparison/package/package.defs';
import type { ComboboxOption } from '~/components/form/Combobox.vue';
import type { SelectOption, SelectSearch } from '~/components/form/select.defs';
import { usePackageMetadataQuery } from '~/composables/usePackageMetadataQuery';
import { usePackageSearchQuery } from '~/composables/usePackageSearchQuery';
import { filterVersionOptions } from '~/pages/versionSearch';

import {
  emptyComparisonFormDraft,
  type ComparisonFormDraft,
  type ComparisonFormRelocation,
} from './comparisonFormState';

const TAG_OPTION_PREFIX = 'tag:';

const VERSION_OPTION_PREFIX = 'version:';

const versionSearch: SelectSearch = {
  filter: filterVersionOptions,
  placeholder: 'Search versions',
  emptyMessage: 'No matching versions',
};

interface VersionCatalog {
  versionByOptionValue: ReadonlyMap<string, string>;
  options: readonly SelectOption[];
}

const emptyVersionCatalog: VersionCatalog = { versionByOptionValue: new Map<string, string>(), options: [] };

const createVersionCatalog = (metadata: ParsedPackageMetadata): VersionCatalog => {
  const versionByOptionValue = new Map<string, string>();

  const distTagOptions = Object.entries(metadata.distTags).map(([tag, version]) => {
    versionByOptionValue.set(`${TAG_OPTION_PREFIX}${tag}`, version);

    return { value: `${TAG_OPTION_PREFIX}${tag}`, label: tag, description: version };
  });

  const packageVersionOptions = metadata.versions.map((version, index) => {
    const value = `${VERSION_OPTION_PREFIX}${version}`;
    versionByOptionValue.set(value, version);

    const option = { value, label: version };

    return index === 0 && distTagOptions.length > 0 ? { ...option, separatorBefore: true } : option;
  });

  return { versionByOptionValue, options: [...distTagOptions, ...packageVersionOptions] };
};

const createToVersionOptions = (
  versionOptions: readonly SelectOption[],
  versionByOptionValue: ReadonlyMap<string, string>,
  fromVersion: string | null,
): readonly SelectOption[] => {
  if (fromVersion === null) {
    return versionOptions;
  }

  const isAtLeastFromVersion = createSemverAtLeastPredicate(fromVersion);

  const filteredOptions = versionOptions.filter((option) => {
    const version = versionByOptionValue.get(option.value);

    return version !== undefined && isAtLeastFromVersion(version);
  });

  const firstVersionIndex = filteredOptions.findIndex((option) => option.value.startsWith(VERSION_OPTION_PREFIX));

  if (firstVersionIndex <= 0) {
    return filteredOptions;
  }

  return filteredOptions.map((option, index) =>
    index === firstVersionIndex ? { ...option, separatorBefore: true } : option,
  );
};

const useComparisonDraft = () => {
  const draft = useState('comparison-form:draft', emptyComparisonFormDraft);
  const isSubmitting = useState('comparison-form:is-submitting', () => false);
  const relocation = useState<ComparisonFormRelocation | null>('comparison-form:relocation', () => null);
  const relocationSequence = useState('comparison-form:relocation-sequence', () => 0);
  const router = useRouter();

  watch(
    () => router.currentRoute.value.path,
    (path) => {
      if (relocation.value !== null && relocation.value.targetPath !== path) {
        relocation.value = null;
      }
    },
    { immediate: true },
  );
  watch(
    () => draft.value.selectedPackage,
    () => {
      draft.value.fromVersionSelection = null;
      draft.value.toVersionSelection = null;
    },
  );

  return { draft, isSubmitting, relocation, relocationSequence };
};

const usePackageSearchOptions = (draft: Ref<ComparisonFormDraft>) => {
  const { data: searchResult, error, isError, isFetching } = usePackageSearchQuery(() => draft.value.searchTerm);

  const packageOptions = computed<readonly ComboboxOption[]>(
    () =>
      searchResult.value?.data.map(({ name, version, description }) => {
        const option = { value: name, label: name, meta: version };

        return description === undefined ? option : { ...option, description };
      }) ?? [],
  );

  return { searchResult, error, isError, isFetching, packageOptions };
};

const usePackageVersionMetadata = (draft: Ref<ComparisonFormDraft>) => {
  const {
    data: packageMetadata,
    isError: isMetadataError,
    isFetching: isMetadataFetching,
  } = usePackageMetadataQuery(() => draft.value.selectedPackage);

  const versionCatalog = computed(() =>
    packageMetadata.value === undefined ? emptyVersionCatalog : createVersionCatalog(packageMetadata.value),
  );

  const versionSelectDisabled = computed(
    () => isMetadataFetching.value || packageMetadata.value === undefined || versionCatalog.value.options.length === 0,
  );

  const versionPlaceholder = computed(() => {
    if (isMetadataFetching.value) {
      return 'Loading…';
    }

    return isMetadataError.value ? 'Unavailable' : '—';
  });

  return {
    packageMetadata,
    isMetadataError,
    isMetadataFetching,
    versionCatalog,
    versionSelectDisabled,
    versionPlaceholder,
  };
};

const useVersionSelection = (draft: Ref<ComparisonFormDraft>, versionCatalog: ComputedRef<VersionCatalog>) => {
  const versionOptions = computed(() => versionCatalog.value.options);

  const selectedFromVersion = computed(() =>
    draft.value.fromVersionSelection === null
      ? null
      : (versionCatalog.value.versionByOptionValue.get(draft.value.fromVersionSelection) ?? null),
  );

  const selectedToVersion = computed(() =>
    draft.value.toVersionSelection === null
      ? null
      : (versionCatalog.value.versionByOptionValue.get(draft.value.toVersionSelection) ?? null),
  );

  const toVersionOptions = computed(() =>
    createToVersionOptions(versionOptions.value, versionCatalog.value.versionByOptionValue, selectedFromVersion.value),
  );

  const canCompare = computed(
    () =>
      draft.value.selectedPackage !== null && selectedFromVersion.value !== null && selectedToVersion.value !== null,
  );

  watch(selectedFromVersion, () => {
    if (
      draft.value.toVersionSelection !== null &&
      !toVersionOptions.value.some((option) => option.value === draft.value.toVersionSelection)
    ) {
      draft.value.toVersionSelection = null;
    }
  });

  return { versionOptions, toVersionOptions, selectedFromVersion, selectedToVersion, canCompare };
};

const setDefaultTargetVersion = (draft: Ref<ComparisonFormDraft>, metadata: ParsedPackageMetadata | undefined) => {
  if (metadata === undefined || draft.value.selectedPackage === null || metadata.name !== draft.value.selectedPackage) {
    return;
  }

  if (metadata.distTags.latest !== undefined) {
    draft.value.toVersionSelection = `${TAG_OPTION_PREFIX}latest`;

    return;
  }

  const newestVersion = metadata.versions[0];

  if (newestVersion !== undefined) {
    draft.value.toVersionSelection = `${VERSION_OPTION_PREFIX}${newestVersion}`;
  }
};

const useDefaultTargetVersion = (
  draft: Ref<ComparisonFormDraft>,
  packageMetadata: Ref<ParsedPackageMetadata | undefined>,
) => {
  watch(packageMetadata, (metadata) => setDefaultTargetVersion(draft, metadata));
};

export const useComparisonForm = () => {
  const state = useComparisonDraft();
  const search = usePackageSearchOptions(state.draft);
  const metadata = usePackageVersionMetadata(state.draft);
  const { versionCatalog, ...packageVersions } = metadata;
  const selection = useVersionSelection(state.draft, versionCatalog);

  useDefaultTargetVersion(state.draft, metadata.packageMetadata);

  return { ...state, ...search, ...packageVersions, ...selection, versionSearch };
};
