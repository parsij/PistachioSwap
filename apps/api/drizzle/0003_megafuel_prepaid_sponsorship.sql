CREATE TABLE sponsorship_payment_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id integer NOT NULL CHECK (chain_id = 56),
  token_address text NOT NULL CHECK (token_address = lower(token_address) AND token_address ~ '^0x[0-9a-f]{40}$'),
  symbol text NOT NULL CHECK (length(symbol) BETWEEN 1 AND 32),
  decimals integer NOT NULL CHECK (decimals BETWEEN 0 AND 36),
  enabled boolean NOT NULL DEFAULT false,
  fee_payment_enabled boolean NOT NULL DEFAULT false,
  approval_sponsorship_enabled boolean NOT NULL DEFAULT false,
  normal_swap_sponsorship_enabled boolean NOT NULL DEFAULT false,
  is_stablecoin boolean NOT NULL DEFAULT false,
  payment_priority integer NOT NULL DEFAULT 0,
  minimum_liquidity_usd_micros bigint NOT NULL CHECK (minimum_liquidity_usd_micros >= 0),
  minimum_gross_trade_usd_micros bigint NOT NULL CHECK (minimum_gross_trade_usd_micros >= 0),
  maximum_gross_trade_usd_micros bigint,
  maximum_price_age_seconds integer NOT NULL CHECK (maximum_price_age_seconds > 0),
  maximum_price_deviation_bps integer NOT NULL CHECK (maximum_price_deviation_bps BETWEEN 0 AND 10000),
  exact_transfer_required boolean NOT NULL DEFAULT true,
  fee_on_transfer_allowed boolean NOT NULL DEFAULT false CHECK (fee_on_transfer_allowed = false),
  rebasing_allowed boolean NOT NULL DEFAULT false CHECK (rebasing_allowed = false),
  strict_security_required boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sponsorship_payment_tokens_chain_address_unique UNIQUE (chain_id, token_address),
  CONSTRAINT sponsorship_payment_tokens_maximum_check CHECK (
    maximum_gross_trade_usd_micros IS NULL OR maximum_gross_trade_usd_micros >= minimum_gross_trade_usd_micros
  )
);

CREATE INDEX sponsorship_payment_tokens_enabled_idx
  ON sponsorship_payment_tokens (chain_id, enabled, fee_payment_enabled);

CREATE TABLE sponsorship_auth_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address text NOT NULL CHECK (wallet_address = lower(wallet_address) AND wallet_address ~ '^0x[0-9a-f]{40}$'),
  chain_id integer NOT NULL CHECK (chain_id = 56),
  nonce_hash text NOT NULL UNIQUE CHECK (nonce_hash ~ '^0x[0-9a-f]{64}$'),
  domain text NOT NULL,
  message text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sponsorship_auth_challenges_wallet_idx
  ON sponsorship_auth_challenges (wallet_address, expires_at);

CREATE TABLE sponsorship_auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address text NOT NULL CHECK (wallet_address = lower(wallet_address) AND wallet_address ~ '^0x[0-9a-f]{40}$'),
  chain_id integer NOT NULL CHECK (chain_id = 56),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^0x[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sponsorship_auth_sessions_wallet_idx
  ON sponsorship_auth_sessions (wallet_address, expires_at);

CREATE TABLE sponsorship_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'quoted' CHECK (status IN (
    'quoted','payment-prepared','payment-signing','payment-submitting','payment-submitted','payment-confirmed',
    'approval-preparing','approval-submitted','approval-confirmed','swap-preparing','swap-submitted',
    'swap-confirmed','completed','expired','rejected','failed','unknown'
  )),
  wallet_address text NOT NULL CHECK (wallet_address = lower(wallet_address) AND wallet_address ~ '^0x[0-9a-f]{40}$'),
  chain_id integer NOT NULL CHECK (chain_id = 56),
  sell_token text NOT NULL CHECK (sell_token = lower(sell_token) AND sell_token ~ '^0x[0-9a-f]{40}$'),
  buy_token text NOT NULL CHECK (buy_token = 'native' OR (buy_token = lower(buy_token) AND buy_token ~ '^0x[0-9a-f]{40}$')),
  gross_input_amount_raw numeric(78,0) NOT NULL CHECK (gross_input_amount_raw > 0),
  net_swap_amount_raw numeric(78,0) NOT NULL CHECK (net_swap_amount_raw > 0 AND net_swap_amount_raw <= gross_input_amount_raw),
  payment_token text NOT NULL CHECK (payment_token = lower(payment_token) AND payment_token ~ '^0x[0-9a-f]{40}$'),
  payment_token_reason text NOT NULL CHECK (payment_token_reason IN ('stablecoin-owned','eligible-sell-token','eligible-buy-token')),
  payment_amount_raw numeric(78,0) NOT NULL CHECK (payment_amount_raw > 0),
  payment_token_decimals integer NOT NULL CHECK (payment_token_decimals BETWEEN 0 AND 36),
  trade_notional_usd_micros bigint NOT NULL CHECK (trade_notional_usd_micros > 0),
  fixed_service_fee_usd_micros bigint NOT NULL CHECK (fixed_service_fee_usd_micros >= 0),
  platform_fee_usd_micros bigint NOT NULL CHECK (platform_fee_usd_micros >= 0),
  commercial_fee_usd_micros bigint NOT NULL CHECK (commercial_fee_usd_micros >= 0),
  gas_reserve_usd_micros bigint NOT NULL CHECK (gas_reserve_usd_micros >= 0),
  total_prepayment_usd_micros bigint NOT NULL CHECK (total_prepayment_usd_micros > 0),
  estimated_payment_gas_usd_micros bigint NOT NULL CHECK (estimated_payment_gas_usd_micros >= 0),
  estimated_approval_gas_usd_micros bigint NOT NULL CHECK (estimated_approval_gas_usd_micros >= 0),
  estimated_swap_gas_usd_micros bigint NOT NULL CHECK (estimated_swap_gas_usd_micros >= 0),
  gas_multiplier_bps integer NOT NULL CHECK (gas_multiplier_bps >= 10000),
  quote_provider text NOT NULL CHECK (quote_provider IN ('0x-gasless','0x','uniswap','pancakeswap')),
  provider_quote_id text,
  provider_quote_expires_at timestamptz,
  provider_quote_snapshot jsonb,
  provider_fees jsonb NOT NULL DEFAULT '{}'::jsonb,
  expected_output_raw numeric(78,0) NOT NULL CHECK (expected_output_raw > 0),
  minimum_output_raw numeric(78,0) NOT NULL CHECK (minimum_output_raw > 0 AND minimum_output_raw <= expected_output_raw),
  requires_approval boolean NOT NULL,
  approval_spender text,
  approval_amount_raw numeric(78,0),
  sponsored_flow text NOT NULL CHECK (sponsored_flow IN ('zero-x-gasless-after-approval','normal-sponsored-swap')),
  billing_mode text NOT NULL CHECK (billing_mode = 'prepaid-megafuel'),
  expires_at timestamptz NOT NULL,
  payment_transaction_hash text,
  approval_transaction_hash text,
  swap_transaction_hash text,
  actual_payment_received_raw numeric(78,0),
  actual_sponsored_gas_usd_micros bigint,
  platform_fee_settled_at timestamptz,
  completed_at timestamptz,
  rejection_code text,
  idempotency_key text NOT NULL UNIQUE,
  ip_hash text NOT NULL CHECK (ip_hash ~ '^0x[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sponsorship_orders_fee_split_check CHECK (
    commercial_fee_usd_micros = fixed_service_fee_usd_micros + platform_fee_usd_micros AND
    total_prepayment_usd_micros = commercial_fee_usd_micros + gas_reserve_usd_micros
  ),
  CONSTRAINT sponsorship_orders_approval_check CHECK (
    (requires_approval AND approval_spender IS NOT NULL AND approval_amount_raw > 0) OR
    (NOT requires_approval AND approval_spender IS NULL AND approval_amount_raw IS NULL)
  )
);

CREATE UNIQUE INDEX sponsorship_orders_one_active_wallet_idx
  ON sponsorship_orders (wallet_address)
  WHERE status NOT IN ('completed','expired','rejected','failed');
CREATE INDEX sponsorship_orders_wallet_status_idx ON sponsorship_orders (wallet_address, status);
CREATE INDEX sponsorship_orders_expiry_idx ON sponsorship_orders (status, expires_at);

ALTER TABLE gas_assist_gasless_quotes
  ADD COLUMN sponsorship_order_id uuid REFERENCES sponsorship_orders(id),
  ADD COLUMN billing_mode text NOT NULL DEFAULT 'provider-integrator'
    CHECK (billing_mode IN ('provider-integrator','prepaid-megafuel'));
CREATE UNIQUE INDEX gas_assist_gasless_sponsorship_order_idx
  ON gas_assist_gasless_quotes (sponsorship_order_id)
  WHERE sponsorship_order_id IS NOT NULL;

CREATE TABLE sponsorship_transaction_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES sponsorship_orders(id),
  action text NOT NULL CHECK (action IN ('fee-payment-transfer','token-approval','normal-swap')),
  status text NOT NULL DEFAULT 'authorized' CHECK (status IN (
    'authorized','prepared','signing','submitting','submitted','confirmed','reverted','expired','rejected','unknown'
  )),
  wallet_address text NOT NULL CHECK (wallet_address = lower(wallet_address) AND wallet_address ~ '^0x[0-9a-f]{40}$'),
  transaction_to text NOT NULL CHECK (transaction_to = lower(transaction_to) AND transaction_to ~ '^0x[0-9a-f]{40}$'),
  transaction_data text NOT NULL CHECK (transaction_data ~ '^0x[0-9a-f]*$'),
  transaction_data_hash text NOT NULL CHECK (transaction_data_hash ~ '^0x[0-9a-f]{64}$'),
  native_value numeric(78,0) NOT NULL DEFAULT 0 CHECK (native_value = 0),
  chain_id integer NOT NULL CHECK (chain_id = 56),
  nonce numeric(78,0) NOT NULL CHECK (nonce >= 0),
  transaction_type text NOT NULL CHECK (transaction_type IN ('legacy')),
  gas_limit numeric(78,0) NOT NULL CHECK (gas_limit > 0),
  gas_price numeric(78,0) NOT NULL CHECK (gas_price = 0),
  max_fee_per_gas numeric(78,0),
  max_priority_fee_per_gas numeric(78,0),
  expires_at timestamptz NOT NULL,
  signed_raw_transaction_hash text,
  transaction_hash text,
  submission_attempts integer NOT NULL DEFAULT 0 CHECK (submission_attempts BETWEEN 0 AND 1),
  failure_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sponsorship_intents_order_action_unique UNIQUE (order_id, action),
  CONSTRAINT sponsorship_intents_legacy_fee_check CHECK (max_fee_per_gas IS NULL AND max_priority_fee_per_gas IS NULL)
);

CREATE UNIQUE INDEX sponsorship_intents_active_wallet_nonce_idx
  ON sponsorship_transaction_intents (wallet_address, nonce)
  WHERE status IN ('authorized','prepared','signing','submitting','submitted','unknown');
CREATE INDEX sponsorship_intents_expiry_idx ON sponsorship_transaction_intents (status, expires_at);

CREATE TABLE sponsorship_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES sponsorship_orders(id),
  wallet_address text NOT NULL CHECK (wallet_address = lower(wallet_address) AND wallet_address ~ '^0x[0-9a-f]{40}$'),
  entry_type text NOT NULL CHECK (entry_type IN (
    'gasReserve','commercialFeeReserve','actualGasConsumed','serviceFeeSettled',
    'platformFeeSettled','unusedGasCredit','walletCredit','adjustment'
  )),
  usd_micros bigint NOT NULL CHECK (usd_micros >= 0),
  token_address text NOT NULL CHECK (token_address = lower(token_address) AND token_address ~ '^0x[0-9a-f]{40}$'),
  token_amount_raw numeric(78,0) NOT NULL CHECK (token_amount_raw >= 0),
  action text,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sponsorship_ledger_order_idx ON sponsorship_ledger (order_id, created_at);
CREATE INDEX sponsorship_ledger_wallet_idx ON sponsorship_ledger (wallet_address, created_at);

CREATE TABLE sponsorship_wallet_credits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address text NOT NULL CHECK (wallet_address = lower(wallet_address) AND wallet_address ~ '^0x[0-9a-f]{40}$'),
  chain_id integer NOT NULL CHECK (chain_id = 56),
  token_address text NOT NULL CHECK (token_address = lower(token_address) AND token_address ~ '^0x[0-9a-f]{40}$'),
  available_token_amount_raw numeric(78,0) NOT NULL DEFAULT 0 CHECK (available_token_amount_raw >= 0),
  available_usd_micros bigint NOT NULL DEFAULT 0 CHECK (available_usd_micros >= 0),
  source_order_id uuid NOT NULL UNIQUE REFERENCES sponsorship_orders(id),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sponsorship_wallet_credits_wallet_idx
  ON sponsorship_wallet_credits (wallet_address, chain_id);

CREATE TABLE sponsorship_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usage_date date NOT NULL,
  chain_id integer NOT NULL CHECK (chain_id = 56),
  scope_type text NOT NULL CHECK (scope_type IN ('wallet','ip','global','token')),
  scope_hash text NOT NULL,
  order_count integer NOT NULL DEFAULT 0 CHECK (order_count >= 0),
  sponsored_gas_usd_micros bigint NOT NULL DEFAULT 0 CHECK (sponsored_gas_usd_micros >= 0),
  token_action_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  rejected_attempts integer NOT NULL DEFAULT 0 CHECK (rejected_attempts >= 0),
  reverted_attempts integer NOT NULL DEFAULT 0 CHECK (reverted_attempts >= 0),
  expired_attempts integer NOT NULL DEFAULT 0 CHECK (expired_attempts >= 0),
  signature_mismatch_attempts integer NOT NULL DEFAULT 0 CHECK (signature_mismatch_attempts >= 0),
  failed_payment_attempts integer NOT NULL DEFAULT 0 CHECK (failed_payment_attempts >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sponsorship_usage_scope_unique UNIQUE (usage_date, chain_id, scope_type, scope_hash)
);

CREATE INDEX sponsorship_usage_day_idx ON sponsorship_usage (usage_date, chain_id);

CREATE OR REPLACE FUNCTION sponsorship_enforce_order_terminal_state()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('completed','expired','rejected','failed') AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'terminal sponsorship order status is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sponsorship_orders_terminal_state_trigger
BEFORE UPDATE ON sponsorship_orders
FOR EACH ROW EXECUTE FUNCTION sponsorship_enforce_order_terminal_state();

CREATE OR REPLACE FUNCTION sponsorship_enforce_intent_immutability()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('confirmed','reverted','expired','rejected') AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'terminal sponsorship intent is immutable';
  END IF;
  IF OLD.submission_attempts >= 1 AND NEW.submission_attempts > OLD.submission_attempts THEN
    RAISE EXCEPTION 'sponsorship intent can only be forwarded once';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sponsorship_intents_immutability_trigger
BEFORE UPDATE ON sponsorship_transaction_intents
FOR EACH ROW EXECUTE FUNCTION sponsorship_enforce_intent_immutability();
