ALTER TABLE sponsorship_transaction_intents
  ADD COLUMN signed_raw_transaction text,
  ADD COLUMN signed_at timestamptz,
  ADD COLUMN first_broadcast_at timestamptz,
  ADD COLUMN last_broadcast_at timestamptz,
  ADD COLUMN submitted_at timestamptz,
  ADD COLUMN finalized_at timestamptz,
  ADD COLUMN broadcast_attempts integer NOT NULL DEFAULT 0
    CHECK (broadcast_attempts BETWEEN 0 AND 3);

ALTER TABLE sponsorship_transaction_intents
  ADD CONSTRAINT sponsorship_intents_signed_raw_transaction_check CHECK (
    signed_raw_transaction IS NULL OR (
      signed_raw_transaction ~ '^0x[0-9a-f]+$' AND
      (length(signed_raw_transaction) - 2) % 2 = 0 AND
      signed_raw_transaction_hash ~ '^0x[0-9a-f]{64}$' AND
      signed_at IS NOT NULL
    )
  );

CREATE INDEX sponsorship_intents_recovery_idx
  ON sponsorship_transaction_intents (status, last_broadcast_at, expires_at)
  WHERE status IN ('submitting','submitted','unknown');

CREATE TABLE sponsorship_intent_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intent_id uuid NOT NULL REFERENCES sponsorship_transaction_intents(id),
  order_id uuid NOT NULL REFERENCES sponsorship_orders(id),
  action text NOT NULL CHECK (action IN (
    'fee-payment-transfer','token-approval','normal-swap'
  )),
  event_type text NOT NULL CHECK (event_type IN (
    'intent-created',
    'raw-transaction-received',
    'broadcast-attempted',
    'transaction-hash-recorded',
    'status-changed'
  )),
  previous_status text,
  status text NOT NULL,
  transaction_hash text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sponsorship_intent_events_intent_idx
  ON sponsorship_intent_events (intent_id, created_at);

CREATE INDEX sponsorship_intent_events_order_idx
  ON sponsorship_intent_events (order_id, created_at);

INSERT INTO sponsorship_intent_events (
  intent_id,
  order_id,
  action,
  event_type,
  status,
  transaction_hash,
  details,
  created_at
)
SELECT
  id,
  order_id,
  action,
  'intent-created',
  status,
  COALESCE(transaction_hash, signed_raw_transaction_hash),
  jsonb_build_object(
    'backfilled', true,
    'nonce', nonce::text,
    'expiresAt', expires_at
  ),
  created_at
FROM sponsorship_transaction_intents;

CREATE OR REPLACE FUNCTION sponsorship_set_intent_lifecycle_fields()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.signed_raw_transaction IS DISTINCT FROM OLD.signed_raw_transaction
     AND NEW.signed_raw_transaction IS NOT NULL THEN
    NEW.signed_at := COALESCE(NEW.signed_at, now());
  END IF;

  IF NEW.status = 'submitting' AND NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.broadcast_attempts := GREATEST(NEW.broadcast_attempts, OLD.broadcast_attempts + 1);
    NEW.first_broadcast_at := COALESCE(NEW.first_broadcast_at, now());
    NEW.last_broadcast_at := COALESCE(NEW.last_broadcast_at, now());
  END IF;

  IF NEW.status = 'submitted' AND NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.submitted_at := COALESCE(NEW.submitted_at, now());
  END IF;

  IF NEW.status IN ('confirmed','reverted','expired','rejected')
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.finalized_at := COALESCE(NEW.finalized_at, now());
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER sponsorship_intents_lifecycle_fields_trigger
BEFORE UPDATE ON sponsorship_transaction_intents
FOR EACH ROW EXECUTE FUNCTION sponsorship_set_intent_lifecycle_fields();

CREATE OR REPLACE FUNCTION sponsorship_log_intent_event()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO sponsorship_intent_events (
      intent_id,order_id,action,event_type,status,transaction_hash,details
    ) VALUES (
      NEW.id,
      NEW.order_id,
      NEW.action,
      'intent-created',
      NEW.status,
      COALESCE(NEW.transaction_hash, NEW.signed_raw_transaction_hash),
      jsonb_build_object('nonce', NEW.nonce::text, 'expiresAt', NEW.expires_at)
    );
    RETURN NEW;
  END IF;

  IF NEW.signed_raw_transaction IS DISTINCT FROM OLD.signed_raw_transaction
     AND NEW.signed_raw_transaction IS NOT NULL THEN
    INSERT INTO sponsorship_intent_events (
      intent_id,order_id,action,event_type,previous_status,status,transaction_hash
    ) VALUES (
      NEW.id,NEW.order_id,NEW.action,'raw-transaction-received',
      OLD.status,NEW.status,COALESCE(NEW.transaction_hash,NEW.signed_raw_transaction_hash)
    );
  END IF;

  IF NEW.broadcast_attempts IS DISTINCT FROM OLD.broadcast_attempts THEN
    INSERT INTO sponsorship_intent_events (
      intent_id,order_id,action,event_type,previous_status,status,transaction_hash,details
    ) VALUES (
      NEW.id,NEW.order_id,NEW.action,'broadcast-attempted',
      OLD.status,NEW.status,COALESCE(NEW.transaction_hash,NEW.signed_raw_transaction_hash),
      jsonb_build_object('attempt',NEW.broadcast_attempts)
    );
  END IF;

  IF NEW.transaction_hash IS DISTINCT FROM OLD.transaction_hash
     AND NEW.transaction_hash IS NOT NULL THEN
    INSERT INTO sponsorship_intent_events (
      intent_id,order_id,action,event_type,previous_status,status,transaction_hash
    ) VALUES (
      NEW.id,NEW.order_id,NEW.action,'transaction-hash-recorded',
      OLD.status,NEW.status,NEW.transaction_hash
    );
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO sponsorship_intent_events (
      intent_id,order_id,action,event_type,previous_status,status,transaction_hash,details
    ) VALUES (
      NEW.id,NEW.order_id,NEW.action,'status-changed',
      OLD.status,NEW.status,COALESCE(NEW.transaction_hash,NEW.signed_raw_transaction_hash),
      jsonb_build_object('failureCode',NEW.failure_code)
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER sponsorship_intents_event_log_insert_trigger
AFTER INSERT ON sponsorship_transaction_intents
FOR EACH ROW EXECUTE FUNCTION sponsorship_log_intent_event();

CREATE TRIGGER sponsorship_intents_event_log_update_trigger
AFTER UPDATE ON sponsorship_transaction_intents
FOR EACH ROW EXECUTE FUNCTION sponsorship_log_intent_event();
