CREATE TABLE IF NOT EXISTS "cross_chain_auth_challenges" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "wallet_address" text NOT NULL,
    "chain_id" integer NOT NULL,
    "nonce_hash" text NOT NULL,
    "domain" text NOT NULL,
    "message" text NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "consumed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cross_chain_auth_sessions" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "wallet_address" text NOT NULL,
    "chain_id" integer NOT NULL,
    "token_hash" text NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "revoked_at" timestamp with time zone,
    "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cross_chain_routes" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "quote_id" uuid NOT NULL,
    "owner_address" text NOT NULL,
    "provider_id" text NOT NULL,
    "execution_model" text NOT NULL,
    "source_asset" jsonb NOT NULL,
    "destination_asset" jsonb NOT NULL,
    "recipient" text NOT NULL,
    "input_amount" numeric(78, 0) NOT NULL,
    "output_amount" numeric(78, 0) NOT NULL,
    "minimum_output_amount" numeric(78, 0) NOT NULL,
    "fee_amount_usd" text,
    "duration_seconds" integer DEFAULT 0 NOT NULL,
    "status" text DEFAULT 'quoted' NOT NULL,
    "provider_status" text,
    "provider_tracking_id" text,
    "source_transaction_hash" text,
    "destination_transaction_hash" text,
    "failure_code" text,
    "submission_attempts" integer DEFAULT 0 NOT NULL,
    "claimed_at" timestamp with time zone,
    "submitted_at" timestamp with time zone,
    "expires_at" timestamp with time zone NOT NULL,
    "public_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "cross_chain_routes_attempts_check" CHECK ("submission_attempts" BETWEEN 0 AND 1),
    CONSTRAINT "cross_chain_routes_amounts_check" CHECK (
        "input_amount" > 0 AND "output_amount" >= 0 AND
        "minimum_output_amount" >= 0 AND "minimum_output_amount" <= "output_amount"
    )
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cross_chain_route_steps" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "route_id" uuid NOT NULL REFERENCES "cross_chain_routes"("id") ON DELETE CASCADE,
    "step_index" integer NOT NULL,
    "step_type" text NOT NULL,
    "label" text NOT NULL,
    "chain_id" integer,
    "status" text DEFAULT 'pending' NOT NULL,
    "transaction_hash" text,
    "public_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "cross_chain_route_steps_index_check" CHECK ("step_index" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cross_chain_routes_quote_idx" ON "cross_chain_routes" ("quote_id");
CREATE UNIQUE INDEX IF NOT EXISTS "cross_chain_auth_challenges_nonce_idx" ON "cross_chain_auth_challenges" ("nonce_hash");
CREATE INDEX IF NOT EXISTS "cross_chain_auth_challenges_wallet_chain_idx" ON "cross_chain_auth_challenges" ("wallet_address", "chain_id", "expires_at");
CREATE UNIQUE INDEX IF NOT EXISTS "cross_chain_auth_sessions_token_idx" ON "cross_chain_auth_sessions" ("token_hash");
CREATE INDEX IF NOT EXISTS "cross_chain_auth_sessions_wallet_chain_idx" ON "cross_chain_auth_sessions" ("wallet_address", "chain_id", "expires_at");
CREATE UNIQUE INDEX IF NOT EXISTS "cross_chain_routes_source_tx_idx" ON "cross_chain_routes" ("source_transaction_hash");
CREATE INDEX IF NOT EXISTS "cross_chain_routes_owner_created_idx" ON "cross_chain_routes" ("owner_address", "created_at");
CREATE INDEX IF NOT EXISTS "cross_chain_routes_status_expiry_idx" ON "cross_chain_routes" ("status", "expires_at");
CREATE INDEX IF NOT EXISTS "cross_chain_routes_provider_tracking_idx" ON "cross_chain_routes" ("provider_id", "provider_tracking_id");
CREATE UNIQUE INDEX IF NOT EXISTS "cross_chain_route_steps_order_idx" ON "cross_chain_route_steps" ("route_id", "step_index");
