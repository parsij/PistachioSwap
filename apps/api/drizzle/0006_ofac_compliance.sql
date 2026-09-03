CREATE TABLE IF NOT EXISTS compliance_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address text NOT NULL,
  chain_id integer,
  action text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('allow','block','unavailable')),
  reason_code text NOT NULL,
  country_code text,
  region_code text,
  list_version text,
  transaction_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (wallet_address ~ '^0x[0-9a-f]{40}$'),
  CHECK (chain_id IS NULL OR chain_id > 0),
  CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$'),
  CHECK (region_code IS NULL OR region_code ~ '^[A-Z0-9-]{1,16}$'),
  CHECK (transaction_hash IS NULL OR transaction_hash ~ '^0x[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS compliance_checks_wallet_created_idx
  ON compliance_checks (wallet_address, created_at DESC);
CREATE INDEX IF NOT EXISTS compliance_checks_decision_created_idx
  ON compliance_checks (decision, created_at DESC);
CREATE INDEX IF NOT EXISTS compliance_checks_tx_idx
  ON compliance_checks (transaction_hash)
  WHERE transaction_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS compliance_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  check_id uuid REFERENCES compliance_checks(id) ON DELETE RESTRICT,
  wallet_address text NOT NULL,
  country_code text,
  region_code text,
  client_ip inet,
  reason_code text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewed','reported','closed')),
  reported_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (wallet_address ~ '^0x[0-9a-f]{40}$'),
  CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$'),
  CHECK (region_code IS NULL OR region_code ~ '^[A-Z0-9-]{1,16}$')
);

CREATE INDEX IF NOT EXISTS compliance_cases_status_created_idx
  ON compliance_cases (status, created_at DESC);
CREATE INDEX IF NOT EXISTS compliance_cases_wallet_created_idx
  ON compliance_cases (wallet_address, created_at DESC);

COMMENT ON TABLE compliance_checks IS
  'Minimal sanctions screening evidence. Do not store raw request payloads, signatures, or private data here.';
COMMENT ON TABLE compliance_cases IS
  'Expanded evidence only for restricted or escalated compliance events. Review reporting obligations separately.';
