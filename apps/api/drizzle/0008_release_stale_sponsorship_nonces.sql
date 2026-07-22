CREATE OR REPLACE FUNCTION sponsorship_release_stale_nonce_before_intent_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IN ('authorized','prepared','signing','submitting','submitted','unknown') THEN
    UPDATE sponsorship_orders AS sponsorship_order
    SET status = 'expired',
        rejection_code = COALESCE(sponsorship_order.rejection_code, 'ORDER_EXPIRED'),
        updated_at = now()
    WHERE sponsorship_order.status NOT IN ('completed','expired','rejected','failed')
      AND sponsorship_order.expires_at <= now()
      AND sponsorship_order.payment_transaction_hash IS NULL
      AND sponsorship_order.approval_transaction_hash IS NULL
      AND sponsorship_order.swap_transaction_hash IS NULL
      AND EXISTS (
        SELECT 1
        FROM sponsorship_transaction_intents AS existing_intent
        WHERE existing_intent.order_id = sponsorship_order.id
          AND existing_intent.wallet_address = NEW.wallet_address
          AND existing_intent.nonce = NEW.nonce
          AND existing_intent.status IN ('authorized','prepared','signing')
          AND existing_intent.signed_raw_transaction IS NULL
          AND existing_intent.transaction_hash IS NULL
          AND existing_intent.submission_attempts = 0
      );

    UPDATE sponsorship_transaction_intents AS existing_intent
    SET status = 'expired',
        failure_code = COALESCE(existing_intent.failure_code, 'STALE_NONCE_RESERVATION'),
        updated_at = now()
    FROM sponsorship_orders AS parent_order
    WHERE existing_intent.order_id = parent_order.id
      AND existing_intent.wallet_address = NEW.wallet_address
      AND existing_intent.nonce = NEW.nonce
      AND parent_order.status IN ('completed','expired','rejected','failed')
      AND existing_intent.status IN ('authorized','prepared','signing')
      AND existing_intent.signed_raw_transaction IS NULL
      AND existing_intent.transaction_hash IS NULL
      AND existing_intent.submission_attempts = 0;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sponsorship_intents_release_stale_nonce_trigger
  ON sponsorship_transaction_intents;

CREATE TRIGGER sponsorship_intents_release_stale_nonce_trigger
BEFORE INSERT ON sponsorship_transaction_intents
FOR EACH ROW EXECUTE FUNCTION sponsorship_release_stale_nonce_before_intent_insert();

UPDATE sponsorship_transaction_intents AS existing_intent
SET status = 'expired',
    failure_code = COALESCE(existing_intent.failure_code, 'STALE_NONCE_RESERVATION'),
    updated_at = now()
FROM sponsorship_orders AS parent_order
WHERE existing_intent.order_id = parent_order.id
  AND parent_order.status IN ('completed','expired','rejected','failed')
  AND existing_intent.status IN ('authorized','prepared','signing')
  AND existing_intent.signed_raw_transaction IS NULL
  AND existing_intent.transaction_hash IS NULL
  AND existing_intent.submission_attempts = 0;
