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
    NEW.grant_expires_at := COALESCE(
      NEW.grant_expires_at,
      NEW.fee_confirmed_at + interval '15 minutes'
    );
    NEW.expires_at := NEW.grant_expires_at;
  END IF;

  RETURN NEW;
END;
$$;
