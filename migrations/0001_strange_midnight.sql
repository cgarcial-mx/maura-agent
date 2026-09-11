ALTER TABLE "bets" ADD COLUMN "reminder_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bets" ADD COLUMN "reminder_sent_at" timestamp with time zone;