CREATE TABLE `media` (
	`user_id` text NOT NULL,
	`spot_id` text NOT NULL,
	`kind` text NOT NULL,
	`object_key` text NOT NULL,
	`mime_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `spot_id`, `kind`)
);
--> statement-breakpoint
CREATE TABLE `visits` (
	`user_id` text NOT NULL,
	`spot_id` text NOT NULL,
	`visited_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `spot_id`)
);
