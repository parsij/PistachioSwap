ALTER TABLE gas_assist_gasless_quotes
  DROP CONSTRAINT gas_assist_gasless_quotes_buy_token_address_check;

ALTER TABLE gas_assist_gasless_quotes
  ADD CONSTRAINT gas_assist_gasless_quotes_buy_token_address_check CHECK (
    buy_token_address = lower(buy_token_address)
    AND buy_token_address ~ '^0x[0-9a-f]{40}$'
    AND buy_token_address <> '0x0000000000000000000000000000000000000000'
  );
