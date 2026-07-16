CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE gas_assist_sponsor_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id integer NOT NULL CHECK (chain_id = 56),
  wallet_address text NOT NULL CHECK (wallet_address = lower(wallet_address) AND wallet_address ~ '^0x[0-9a-f]{40}$' AND wallet_address <> '0x0000000000000000000000000000000000000000'),
  token_address text NOT NULL CHECK (token_address = lower(token_address) AND token_address ~ '^0x[0-9a-f]{40}$' AND token_address <> '0x0000000000000000000000000000000000000000'),
  minimum_amount_base_units numeric(78,0) NOT NULL CHECK (minimum_amount_base_units > 0),
  maximum_amount_base_units numeric(78,0),
  enabled boolean NOT NULL DEFAULT true,
  expires_at timestamptz,
  maximum_sponsorships_per_day integer CHECK (maximum_sponsorships_per_day > 0),
  maximum_total_amount_per_day_base_units numeric(78,0) CHECK (maximum_total_amount_per_day_base_units > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gas_assist_rule_maximum_check CHECK (maximum_amount_base_units IS NULL OR maximum_amount_base_units >= minimum_amount_base_units),
  CONSTRAINT gas_assist_rule_exact_unique UNIQUE (chain_id, wallet_address, token_address)
);
CREATE INDEX gas_assist_rules_enabled_idx ON gas_assist_sponsor_rules (chain_id, enabled);
CREATE INDEX gas_assist_rules_expiry_idx ON gas_assist_sponsor_rules (expires_at);

CREATE TABLE gas_assist_swap_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id integer NOT NULL CHECK (chain_id = 56),
  wallet_address text NOT NULL,
  sell_token_address text NOT NULL,
  buy_token_address text NOT NULL,
  amount_in numeric(78,0) NOT NULL CHECK (amount_in > 0),
  swap_contract_address text,
  provider_quote_id text NOT NULL,
  route_executable_through_swap_contract boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled', 'expired')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX gas_assist_intents_wallet_expiry_idx ON gas_assist_swap_intents (chain_id, wallet_address, expires_at);
CREATE INDEX gas_assist_intents_status_idx ON gas_assist_swap_intents (status, expires_at);

CREATE TABLE gas_assist_approval_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id integer NOT NULL CHECK (chain_id = 56),
  wallet_address text NOT NULL,
  token_address text NOT NULL,
  spender_address text NOT NULL,
  amount_in numeric(78,0) NOT NULL CHECK (amount_in > 0),
  sponsor_rule_id uuid NOT NULL REFERENCES gas_assist_sponsor_rules(id),
  swap_intent_id uuid NOT NULL REFERENCES gas_assist_swap_intents(id),
  nonce numeric(78,0) NOT NULL CHECK (nonce >= 0),
  gas_limit numeric(78,0) NOT NULL CHECK (gas_limit > 0),
  transaction_type text NOT NULL DEFAULT 'legacy' CHECK (transaction_type = 'legacy'),
  unsigned_transaction_hash text NOT NULL,
  calldata_hash text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','signing','submitting','submitted','confirmed','expired','rejected','failed')),
  sponsor_policy_reference text,
  expires_at timestamptz NOT NULL,
  submitted_tx_hash text,
  failure_code text,
  submission_attempts integer NOT NULL DEFAULT 0 CHECK (submission_attempts >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX gas_assist_quotes_wallet_status_idx ON gas_assist_approval_quotes (chain_id, wallet_address, status);
CREATE INDEX gas_assist_quotes_expiry_idx ON gas_assist_approval_quotes (expires_at);
CREATE INDEX gas_assist_quotes_intent_idx ON gas_assist_approval_quotes (swap_intent_id);

CREATE TABLE gas_assist_sponsorship_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid REFERENCES gas_assist_approval_quotes(id),
  sponsor_rule_id uuid REFERENCES gas_assist_sponsor_rules(id),
  chain_id integer NOT NULL CHECK (chain_id = 56),
  wallet_address_hash text NOT NULL,
  ip_hash text NOT NULL,
  token_address text NOT NULL,
  outcome text NOT NULL,
  provider_code text,
  transaction_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX gas_assist_attempts_quote_idx ON gas_assist_sponsorship_attempts (quote_id);
CREATE INDEX gas_assist_attempts_created_idx ON gas_assist_sponsorship_attempts (chain_id, created_at);

CREATE TABLE gas_assist_daily_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usage_date date NOT NULL,
  chain_id integer NOT NULL CHECK (chain_id = 56),
  sponsor_rule_id uuid NOT NULL REFERENCES gas_assist_sponsor_rules(id),
  wallet_address_hash text NOT NULL,
  ip_hash text NOT NULL,
  sponsored_count integer NOT NULL DEFAULT 0 CHECK (sponsored_count >= 0),
  sponsored_gas bigint NOT NULL DEFAULT 0 CHECK (sponsored_gas >= 0),
  sponsored_amount_base_units numeric(78,0) NOT NULL DEFAULT 0 CHECK (sponsored_amount_base_units >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gas_assist_usage_scope_unique UNIQUE (usage_date, chain_id, sponsor_rule_id, wallet_address_hash, ip_hash)
);
CREATE INDEX gas_assist_usage_wallet_day_idx ON gas_assist_daily_usage (usage_date, chain_id, wallet_address_hash);
CREATE INDEX gas_assist_usage_ip_day_idx ON gas_assist_daily_usage (usage_date, chain_id, ip_hash);
