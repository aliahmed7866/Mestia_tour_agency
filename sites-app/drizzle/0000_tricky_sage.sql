CREATE TABLE `blocks` (
	`id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `operations` (
	`key` text PRIMARY KEY NOT NULL,
	`at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `requests` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`idempotency` text NOT NULL,
	`data` text NOT NULL,
	`version` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `request_token` ON `requests` (`token`);--> statement-breakpoint
CREATE UNIQUE INDEX `request_idempotency` ON `requests` (`idempotency`);--> statement-breakpoint
CREATE TABLE `reservations` (
	`resource_id` text NOT NULL,
	`slot` text NOT NULL,
	`unit` integer NOT NULL,
	`request_id` text NOT NULL,
	PRIMARY KEY(`resource_id`, `slot`, `unit`)
);
--> statement-breakpoint
CREATE TABLE `resources` (
	`id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `services` (
	`id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL
);
