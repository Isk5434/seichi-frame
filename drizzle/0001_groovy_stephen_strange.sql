CREATE TABLE `spot_photos` (
	`id` text NOT NULL,
	`user_id` text NOT NULL,
	`spot_id` text NOT NULL,
	`object_key` text NOT NULL,
	`mime_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `id`)
);
