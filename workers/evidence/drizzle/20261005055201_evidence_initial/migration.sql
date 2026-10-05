CREATE TABLE `evidence_chunks` (
	`key` text NOT NULL,
	`chunk_index` integer NOT NULL,
	`payload` text NOT NULL,
	CONSTRAINT `evidence_chunks_pk` PRIMARY KEY(`key`, `chunk_index`)
);
--> statement-breakpoint
CREATE TABLE `evidence_records` (
	`key` text PRIMARY KEY NOT NULL,
	`expires_at` integer,
	`chunk_count` integer NOT NULL,
	`byte_length` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `evidence_expiry_index` ON `evidence_records` (`expires_at`) WHERE "evidence_records"."expires_at" is not null;