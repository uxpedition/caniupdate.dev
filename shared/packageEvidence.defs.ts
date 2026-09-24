export type PackageEvidenceBodyReader = {
  read(): Promise<{ readonly done: boolean; readonly value?: unknown }>;
  cancel(reason?: unknown): Promise<void>;
  releaseLock(): void;
};

export type PackageEvidenceResponseBody = {
  cancel(reason?: unknown): Promise<void>;
  getReader(): PackageEvidenceBodyReader;
};

export type PackageEvidenceResponse = {
  readonly ok: boolean;
  readonly headers: Pick<Headers, 'get'>;
  readonly body: PackageEvidenceResponseBody | null;
  json(): Promise<unknown>;
};

export type PackageEvidenceObject = {
  fetch(
    input: string,
    init: { readonly method: string; readonly headers: Record<string, string>; readonly body: string },
  ): Promise<PackageEvidenceResponse>;
};

/** Minimal request-scoped port used by the public worker to call package evidence objects. */
export interface PackageEvidenceNamespace {
  idFromName(name: string): object;
  get(id: object): PackageEvidenceObject;
}
