CREATE TABLE market_token_catalog_cache (
  chain_id integer PRIMARY KEY CHECK (chain_id > 0),
  schema_version integer NOT NULL CHECK (schema_version > 0),
  ranked_tokens jsonb NOT NULL,
  common_tokens jsonb NOT NULL,
  provider_status jsonb,
  exclusion_counts jsonb,
  partial boolean NOT NULL DEFAULT false,
  generated_at timestamptz,
  last_attempted_at timestamptz,
  last_success_at timestamptz,
  next_refresh_at timestamptz,
  content_hash text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT market_token_catalog_ranked_array_check
    CHECK (jsonb_typeof(ranked_tokens) = 'array'),
  CONSTRAINT market_token_catalog_common_array_check
    CHECK (jsonb_typeof(common_tokens) = 'array')
);

CREATE INDEX market_token_catalog_next_refresh_idx
  ON market_token_catalog_cache (next_refresh_at);

CREATE INDEX market_token_catalog_last_success_idx
  ON market_token_catalog_cache (last_success_at);
