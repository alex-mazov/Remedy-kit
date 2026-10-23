CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TYPE "public"."actor" AS ENUM('app', 'agent');--> statement-breakpoint
CREATE TYPE "public"."expiry_precision" AS ENUM('day', 'month');--> statement-breakpoint
CREATE TYPE "public"."item_source" AS ENUM('app', 'scan', 'agent');--> statement-breakpoint
CREATE TYPE "public"."item_status" AS ENUM('in_stock', 'discarded', 'used_up');--> statement-breakpoint
CREATE TABLE "action_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"actor" "actor" NOT NULL,
	"oauth_client_id" text,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"undone_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "cabinet" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "category" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"key" text NOT NULL,
	"name_ru" text NOT NULL,
	"name_kk" text,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"cabinet_id" uuid NOT NULL,
	"gtin" text,
	"name" text NOT NULL,
	"substance" text,
	"form" text,
	"dosage" text,
	"expiry_date" date,
	"expiry_precision" "expiry_precision" DEFAULT 'day' NOT NULL,
	"batch" text,
	"serial" text,
	"quantity" integer,
	"unit" text,
	"category_id" uuid,
	"status" "item_status" DEFAULT 'in_stock' NOT NULL,
	"notes" text,
	"created_via" "item_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product" (
	"gtin" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"substance" text,
	"form" text,
	"dosage" text,
	"confirmations" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"region" text DEFAULT 'default' NOT NULL,
	"notify_days" integer DEFAULT 30 NOT NULL,
	"locale" text DEFAULT 'ru' NOT NULL,
	"timezone" text DEFAULT 'Asia/Almaty' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "action_log" ADD CONSTRAINT "action_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cabinet" ADD CONSTRAINT "cabinet_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category" ADD CONSTRAINT "category_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item" ADD CONSTRAINT "item_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item" ADD CONSTRAINT "item_cabinet_id_cabinet_id_fk" FOREIGN KEY ("cabinet_id") REFERENCES "public"."cabinet"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item" ADD CONSTRAINT "item_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "action_log_user_created_idx" ON "action_log" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "action_log_batch_idx" ON "action_log" USING btree ("batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cabinet_user_name_uq" ON "cabinet" USING btree ("user_id",lower("name")) WHERE "cabinet"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "category_user_key_uq" ON "category" USING btree (coalesce("user_id", ''),"key");--> statement-breakpoint
CREATE INDEX "item_user_status_expiry_idx" ON "item" USING btree ("user_id","status","expiry_date");--> statement-breakpoint
CREATE INDEX "item_cabinet_idx" ON "item" USING btree ("cabinet_id");--> statement-breakpoint
CREATE UNIQUE INDEX "item_user_serial_uq" ON "item" USING btree ("user_id","gtin","serial") WHERE "item"."serial" is not null;--> statement-breakpoint
CREATE INDEX "item_name_trgm_idx" ON "item" USING gin (lower("name") gin_trgm_ops);
--> statement-breakpoint
-- Default categories (user_id is null). Users can add their own later.
INSERT INTO "category" ("key", "name_ru", "name_kk", "sort") VALUES
  ('pain_fever', 'Боль и температура', 'Ауырсыну және қызба', 10),
  ('cold_flu', 'Простуда и горло', 'Суық тию және тамақ', 20),
  ('allergy', 'Аллергия', 'Аллергия', 30),
  ('digestion', 'Пищеварение', 'Ас қорыту', 40),
  ('heart_pressure', 'Сердце и давление', 'Жүрек және қан қысымы', 50),
  ('first_aid', 'Первая помощь и перевязка', 'Алғашқы көмек және таңу', 60),
  ('skin', 'Кожа', 'Тері', 70),
  ('eyes_ears', 'Глаза и уши', 'Көз және құлақ', 80),
  ('vitamins', 'Витамины и добавки', 'Дәрумендер және қоспалар', 90),
  ('children', 'Детское', 'Балаларға', 100),
  ('prescription', 'По назначению врача', 'Дәрігер тағайындауы бойынша', 110),
  ('other', 'Другое', 'Басқа', 1000);
