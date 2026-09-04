CREATE TABLE `mutation_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`fingerprint` text NOT NULL,
	`status` integer NOT NULL,
	`body` text
);
