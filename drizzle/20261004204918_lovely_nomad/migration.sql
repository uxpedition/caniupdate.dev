CREATE TABLE `package_briefings` (
	`evidence_hash` text PRIMARY KEY NOT NULL,
	`response_json` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
