-- ── Fix: layer 1 (blocking) was over-broad, overlapping layer 2's scope ──────
-- Discovered via end-to-end testing: "Please invest with me, I guarantee
-- returns, just send me money now" got hard-BLOCKED by layer 1's generic
-- "send (me )?(the )?(money|funds|payment)" pattern, when per spec this kind
-- of softer solicitation language belongs to layer 2 (flag for review, never
-- block) — layer 1 should stay to unambiguous, near-zero-false-positive scam
-- mechanisms (gift cards, wire transfer, western union/moneygram, direct
-- cashapp/venmo/zelle requests) plus hard financial identifiers (IBAN, card
-- numbers, wallet addresses, bank account/routing numbers). Removing the
-- over-broad phrase from the blocking layer; layer 2 already covers "send me
-- money" as a soft financial-solicitation flag.
CREATE OR REPLACE FUNCTION p2p_block_message_content()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_financial_pattern text := '\yiban\y' ||
    '|\y[a-z]{2}\d{2}[a-z0-9]{11,30}\y' ||                                   -- IBAN
    '|\y4[0-9]{3}[- ]?[0-9]{4}[- ]?[0-9]{4}[- ]?[0-9]{4}\y' ||               -- Visa
    '|\y5[1-5][0-9]{2}[- ]?[0-9]{4}[- ]?[0-9]{4}[- ]?[0-9]{4}\y' ||          -- Mastercard
    '|\y3[47][0-9]{2}[- ]?[0-9]{6}[- ]?[0-9]{5}\y' ||                        -- Amex
    '|\y6(?:011|5[0-9]{2})[0-9]{12}\y' ||                                    -- Discover
    '|\y0x[a-f0-9]{40}\y' ||                                                 -- ETH wallet
    '|\ybc1[a-z0-9]{25,39}\y' ||                                             -- BTC bech32 wallet
    '|\y[13][a-km-zA-HJ-NP-Z1-9]{25,34}\y' ||                                -- BTC legacy wallet
    '|\y(routing|account|acct)\s*(number|#|no\.?)\y' ||
    '|\y(swift|bic|ifsc|sort code)\y' ||
    '|\ywestern union\y|\ymoneygram\y|\ywire transfer\y|\ywire me\y|\ywire the money\y' ||
    '|\ygift card' ||
    '|\y(itunes|google play|amazon) (gift )?card\y' ||
    '|\ycash ?app me\y|\yvenmo me\y|\yzelle me\y';
  v_contact_pattern text := '\ywhatsapp\y|\ytelegram\y|\ysignal me\y|\ytext me at\y|\ycall me at\y' ||
    '|\y\+?\d{1,3}[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\y';
  v_prior_message_count int;
BEGIN
  IF NEW.body IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.body ~* v_financial_pattern THEN
    RAISE EXCEPTION 'For your safety, we don''t allow sharing financial details or wallet addresses in messages.';
  END IF;

  SELECT count(*) INTO v_prior_message_count FROM p2p_messages WHERE conversation_id = NEW.conversation_id;
  IF v_prior_message_count < 5 AND NEW.body ~* v_contact_pattern THEN
    RAISE EXCEPTION 'For your safety, please don''t share phone numbers or move this conversation off the app this early on.';
  END IF;

  RETURN NEW;
END;
$$;
