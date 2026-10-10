export type PackageEvidenceBodyReadResult = { readonly done: boolean; readonly value?: unknown };

export type PackageEvidenceBodyReader = {
  read(): Promise<PackageEvidenceBodyReadResult>;
  // Mirrors WHATWG ReadableStream.cancel: the reason is opaque, forwarded to the runtime, and never inspected here.
  cancel<Reason>(reason?: Reason): Promise<void>;
  releaseLock(): void;
};

export type PackageEvidenceResponseBody = {
  // Mirrors WHATWG Response-body cancel: the reason is opaque, forwarded to the runtime, and never inspected here.
  cancel<Reason>(reason?: Reason): Promise<void>;
  getReader(): PackageEvidenceBodyReader;
};

export type PackageEvidenceResponse = {
  readonly ok: boolean;
  readonly status: number;
  readonly headers: Pick<Headers, 'get'>;
  readonly body: PackageEvidenceResponseBody | null;
};

export type PackageEvidenceObject = {
  fetch(
    input: string,
    init: { readonly method: string; readonly headers: Record<string, string>; readonly body: string },
  ): Promise<PackageEvidenceResponse>;
};

/** The opaque request-scoped object id; only its string identity is meaningful at this port. */
export type PackageEvidenceObjectId = { toString(): string };

/** Minimal request-scoped port used by the public worker to call package evidence objects. */
export interface PackageEvidenceNamespace {
  idFromName(name: string): PackageEvidenceObjectId;
  get(id: PackageEvidenceObjectId): PackageEvidenceObject;
}
