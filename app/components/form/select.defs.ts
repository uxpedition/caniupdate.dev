export interface SelectOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
  separatorBefore?: boolean;
}

export interface SelectSearch {
  filter: (options: readonly SelectOption[], term: string) => readonly SelectOption[];
  placeholder?: string;
  emptyMessage?: string;
}
