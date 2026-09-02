CREATE TABLE `sync_device_todo_tokens` (
  `token_hash` text PRIMARY KEY NOT NULL,
  `account_id` text NOT NULL,
  `device_id` text NOT NULL,
  `device_name` text NOT NULL,
  `scopes` text NOT NULL,
  `created_at` integer NOT NULL,
  `expires_at` integer NOT NULL,
  `revoked_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sync_device_todo_tokens_account_device` ON `sync_device_todo_tokens` (`account_id`,`device_id`);
--> statement-breakpoint
CREATE INDEX `sync_device_todo_tokens_account` ON `sync_device_todo_tokens` (`account_id`);
--> statement-breakpoint
CREATE TABLE `sync_device_todo_actions` (
  `operation_id` text PRIMARY KEY NOT NULL,
  `account_id` text NOT NULL,
  `generation` integer NOT NULL,
  `device_id` text NOT NULL,
  `sequence` integer NOT NULL,
  `input_hash` text NOT NULL,
  `note_id` text NOT NULL,
  `topic_id` text NOT NULL,
  `block_id` text NOT NULL,
  `action` text NOT NULL,
  `result_revision` text NOT NULL,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sync_device_todo_actions_account_generation` ON `sync_device_todo_actions` (`account_id`,`generation`);
--> statement-breakpoint
CREATE UNIQUE INDEX `sync_device_todo_actions_device_sequence` ON `sync_device_todo_actions` (`account_id`,`generation`,`device_id`,`sequence`);
