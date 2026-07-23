CREATE OR REPLACE FUNCTION sponsorship_expire_unsigned_intents_for_terminal_order()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IN ('completed','expired','rejected','failed')
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    UPDATE sponsorship_transaction_intents
    SET status = 'expired',
        failure_code = COALESCE(failure_code, 'PARENT_ORDER_TERMINAL'),
        updated_at = now()
    WHERE order_id = NEW.id
      AND status IN ('authorized','prepared','signing')
      AND signed_raw_transaction IS NULL
      AND transaction_hash IS NULL
      AND submission_attempts = 0;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sponsorship_orders_expire_unsigned_intents_trigger
  ON sponsorship_orders;

CREATE TRIGGER sponsorship_orders_expire_unsigned_intents_trigger
AFTER UPDATE OF status ON sponsorship_orders
FOR EACH ROW EXECUTE FUNCTION sponsorship_expire_unsigned_intents_for_terminal_order();

UPDATE sponsorship_transaction_intents AS intent
SET status = 'expired',
    failure_code = COALESCE(intent.failure_code, 'PARENT_ORDER_TERMINAL'),
    updated_at = now()
FROM sponsorship_orders AS sponsorship_order
WHERE sponsorship_order.id = intent.order_id
  AND sponsorship_order.status IN ('completed','expired','rejected','failed')
  AND intent.status IN ('authorized','prepared','signing')
  AND intent.signed_raw_transaction IS NULL
  AND intent.transaction_hash IS NULL
  AND intent.submission_attempts = 0;
