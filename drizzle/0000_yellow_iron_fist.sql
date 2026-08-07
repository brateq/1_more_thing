CREATE TABLE `thoughts` (
	`id` text PRIMARY KEY NOT NULL,
	`text` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_presented_at` integer,
	`completed_at` integer,
	`updated_at` integer NOT NULL,
	CONSTRAINT "thought_status_check" CHECK("thoughts"."status" in ('active', 'done'))
);
