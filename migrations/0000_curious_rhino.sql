CREATE TABLE "bet_confirmations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bet_id" uuid NOT NULL,
	"result" text NOT NULL,
	"source" text NOT NULL,
	"corrected" boolean DEFAULT false NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pseudonym" uuid NOT NULL,
	"pattern_id" uuid,
	"reading_text" text NOT NULL,
	"variable" text NOT NULL,
	"direction" text NOT NULL,
	"window_spec" jsonb NOT NULL,
	"predicted_date" date NOT NULL,
	"result" text,
	"confirmed_at" timestamp with time zone,
	"belief_prior" numeric NOT NULL,
	"belief_posterior" numeric,
	"engine_version" text NOT NULL,
	"generator" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lesson_key" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"topics" text[] NOT NULL,
	"life_stages" text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_lesson_key_unique" UNIQUE("lesson_key")
);
--> statement-breakpoint
CREATE TABLE "cycle_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pseudonym" uuid NOT NULL,
	"event_type" text NOT NULL,
	"event_date" date NOT NULL,
	"source" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lessons_delivered" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pseudonym" uuid NOT NULL,
	"lesson_key" text NOT NULL,
	"bet_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pseudonym" uuid NOT NULL,
	"kind" text NOT NULL,
	"content" text NOT NULL,
	"source_bet_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pattern_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ontology_version" text NOT NULL,
	"variable" text NOT NULL,
	"direction" text NOT NULL,
	"window_kind" text NOT NULL,
	"window_spec" jsonb NOT NULL,
	"condition_vocab" text[],
	"prior" numeric NOT NULL,
	"evidence_source" text NOT NULL,
	"evidence_level" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patterns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pseudonym" uuid NOT NULL,
	"variable" text NOT NULL,
	"direction" text NOT NULL,
	"window_spec" jsonb NOT NULL,
	"belief" numeric DEFAULT '0.5' NOT NULL,
	"specificity" numeric DEFAULT '0.0' NOT NULL,
	"status" text DEFAULT 'candidate' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pseudonym" uuid NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"send_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pseudonym" uuid NOT NULL,
	"signal_type" text NOT NULL,
	"value" text,
	"unit" text,
	"cycle_day" integer,
	"context" jsonb,
	"source" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pseudonym" uuid DEFAULT gen_random_uuid() NOT NULL,
	"whatsapp_phone" text,
	"life_stage" text,
	"has_diagnosis" boolean DEFAULT false,
	"diagnosis_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "users_pseudonym_unique" UNIQUE("pseudonym"),
	CONSTRAINT "users_whatsapp_phone_unique" UNIQUE("whatsapp_phone")
);
--> statement-breakpoint
ALTER TABLE "bet_confirmations" ADD CONSTRAINT "bet_confirmations_bet_id_bets_id_fk" FOREIGN KEY ("bet_id") REFERENCES "public"."bets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bets" ADD CONSTRAINT "bets_pattern_id_patterns_id_fk" FOREIGN KEY ("pattern_id") REFERENCES "public"."patterns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_bets_pseudonym" ON "bets" USING btree ("pseudonym");--> statement-breakpoint
CREATE INDEX "idx_bets_predicted_date" ON "bets" USING btree ("predicted_date") WHERE "bets"."result" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_patterns_pseudonym" ON "patterns" USING btree ("pseudonym");--> statement-breakpoint
CREATE INDEX "idx_signals_pseudonym" ON "signals" USING btree ("pseudonym");