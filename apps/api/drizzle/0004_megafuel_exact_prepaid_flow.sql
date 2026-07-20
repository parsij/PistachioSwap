ALTER TABLE sponsorship_orders
  ADD COLUMN payment_quote_expires_at timestamptz,
  ADD COLUMN grant_expires_at timestamptz,
  ADD COLUMN fee_confirmed_at timestamptz,
  ADD COLUMN conversion_cost_usd_micros bigint NOT NULL DEFAULT 0
    CHECK (conversion_cost_usd_micros >= 0);

UPDATE sponsorship_orders
SET payment_quote_expires_at = expires_at
WHERE payment_quote_expires_at IS NULL;

ALTER TABLE sponsorship_orders
  ALTER COLUMN payment_quote_expires_at SET NOT NULL;

ALTER TABLE sponsorship_orders
  DROP CONSTRAINT sponsorship_orders_fee_split_check;

ALTER TABLE sponsorship_orders
  ADD CONSTRAINT sponsorship_orders_fee_split_check CHECK (
    commercial_fee_usd_micros = fixed_service_fee_usd_micros + platform_fee_usd_micros AND
    total_prepayment_usd_micros = commercial_fee_usd_micros + gas_reserve_usd_micros + conversion_cost_usd_micros
  );

CREATE OR REPLACE FUNCTION sponsorship_set_exact_flow_expiry()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.payment_quote_expires_at IS NULL THEN
      NEW.payment_quote_expires_at := NEW.expires_at;
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status <> 'payment-confirmed' AND NEW.status = 'payment-confirmed' THEN
    NEW.fee_confirmed_at := COALESCE(NEW.fee_confirmed_at, now());
    NEW.grant_expires_at := COALESCE(NEW.grant_expires_at, NEW.fee_confirmed_at + interval '5 minutes');
    NEW.expires_at := NEW.grant_expires_at;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER sponsorship_orders_exact_flow_expiry_insert_trigger
BEFORE INSERT ON sponsorship_orders
FOR EACH ROW EXECUTE FUNCTION sponsorship_set_exact_flow_expiry();

CREATE TRIGGER sponsorship_orders_exact_flow_expiry_update_trigger
BEFORE UPDATE OF status ON sponsorship_orders
FOR EACH ROW EXECUTE FUNCTION sponsorship_set_exact_flow_expiry();

CREATE INDEX sponsorship_orders_payment_quote_expiry_idx
  ON sponsorship_orders (status, payment_quote_expires_at);

CREATE INDEX sponsorship_orders_grant_expiry_idx
  ON sponsorship_orders (status, grant_expires_at)
  WHERE grant_expires_at IS NOT NULL;
