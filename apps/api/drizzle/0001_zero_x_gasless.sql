CREATE TABLE gas_assist_gasless_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zid text,
  chain_id integer NOT NULL CHECK (chain_id = 56),
  wallet_address text NOT NULL CHECK (wallet_address = lower(wallet_address) AND wallet_address ~ '^0x[0-9a-f]{40}$'),
  sell_token_address text NOT NULL CHECK (sell_token_address = lower(sell_token_address) AND sell_token_address ~ '^0x[0-9a-f]{40}$' AND sell_token_address <> '0x0000000000000000000000000000000000000000'),
  buy_token_address text NOT NULL CHECK (buy_token_address = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'),
  requested_sell_amount numeric(78,0) NOT NULL CHECK (requested_sell_amount > 0),
  quoted_sell_amount numeric(78,0) NOT NULL CHECK (quoted_sell_amount > 0),
  buy_amount numeric(78,0) NOT NULL CHECK (buy_amount > 0),
  minimum_buy_amount numeric(78,0) NOT NULL CHECK (minimum_buy_amount > 0),
  fees jsonb NOT NULL,
  route jsonb NOT NULL,
  approval jsonb,
  trade jsonb NOT NULL,
  approval_required boolean NOT NULL,
  gasless_approval_available boolean NOT NULL,
  approval_amount numeric(78,0),
  approval_unlimited boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'awaiting_signatures' CHECK (status IN ('awaiting_signatures','submitting','submitted','pending','succeeded','confirmed','failed','expired','cancelled')),
  expires_at timestamptz NOT NULL,
  approval_signature_hash text,
  trade_signature_hash text,
  trade_hash text,
  transaction_hash text,
  provider_status text,
  failure_code text,
  submission_attempts integer NOT NULL DEFAULT 0 CHECK (submission_attempts >= 0 AND submission_attempts <= 3),
  last_status_checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gas_assist_gasless_approval_shape CHECK (
    (approval_required AND gasless_approval_available AND approval IS NOT NULL) OR
    (NOT approval_required AND NOT gasless_approval_available AND approval IS NULL)
  )
);
CREATE INDEX gas_assist_gasless_wallet_created_idx ON gas_assist_gasless_quotes (chain_id, wallet_address, created_at);
CREATE INDEX gas_assist_gasless_status_expiry_idx ON gas_assist_gasless_quotes (status, expires_at);
CREATE UNIQUE INDEX gas_assist_gasless_trade_hash_idx ON gas_assist_gasless_quotes (trade_hash) WHERE trade_hash IS NOT NULL;
