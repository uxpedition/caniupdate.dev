CREATE TABLE IF NOT EXISTS package_briefings (
  evidence_hash TEXT PRIMARY KEY NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
