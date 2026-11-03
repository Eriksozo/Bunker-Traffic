CREATE TABLE `bunker_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`project` text NOT NULL,
	`created_at` text NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `bunker_reports_project_created_idx` ON `bunker_reports` (`project`,`created_at`,`id`);