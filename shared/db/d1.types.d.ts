import type {
  D1Database as CloudflareD1Database,
  D1DatabaseSession as CloudflareD1DatabaseSession,
  D1PreparedStatement as CloudflareD1PreparedStatement,
  D1Response as CloudflareD1Response,
  D1Result as CloudflareD1Result,
} from '@cloudflare/workers-types';

// The pinned D1 driver references SDK globals; import only its type dependencies, never the SDK's blanket globals.
declare global {
  type D1Database = CloudflareD1Database;
  type D1DatabaseSession = CloudflareD1DatabaseSession;
  type D1PreparedStatement = CloudflareD1PreparedStatement;
  type D1Response = CloudflareD1Response;
  type D1Result<Row = unknown> = CloudflareD1Result<Row>;
}
