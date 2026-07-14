-- ── Fix: \b is not a word-boundary escape in this Postgres, \y is ────────────
-- Discovered via end-to-end testing (not caught by migration 021 applying
-- cleanly — the CREATE FUNCTION succeeded fine, the regex just silently never
-- matched anything, at any layer). Confirmed directly:
--   'hello world' ~* '\bhello\b'  -> false
--   'hello world' ~* '\yhello\y'  -> true
-- \b is apparently treated as a literal backspace escape here rather than a
-- word-boundary metacharacter, so it can never match against normal text.
-- Every \b in migration 021's patterns is replaced with \y below — same
-- patterns, same behavior intended, just the actually-correct escape.
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
    '|\ycash ?app me\y|\yvenmo me\y|\yzelle me\y' ||
    '|\ysend (me )?(the )?(money|funds|payment)\y';
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

CREATE OR REPLACE FUNCTION p2p_classify_message_content()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_financial_solicitation text := '\ysend (me )?money\y|\yneed (financial help|money urgently)\y' ||
    '|\yinvest with me\y|\yguaranteed returns?\y|\ydouble your money\y' ||
    '|\yprocessing fee\y|\yadvance fee\y|\yloan (me|you)\y|\yi need \$?\d+\y';
  v_sexual_solicitation text := '\ysend (me )?nudes?\y|\ynude (photo|pic|picture)s?\y' ||
    '|\ynaked (photo|pic|picture)s?\y|\ysexy pics?\y|\yonlyfans\y';
  v_self_harm text := '\ykill myself\y|\ywant(ed)? to die\y|\yend(ing)? my life\y|\yend it all\y' ||
    '|\ysuicid(e|al)\y|\yself.?harm\y|\ycutting myself\y|\yhurt(ing)? myself\y' ||
    '|\yno reason to live\y|\ybetter off dead\y|\ycan''t go on\y|\ycant go on\y' ||
    '|\ydon''t want to (be here|live) anymore\y|\ydont want to (be here|live) anymore\y' ||
    '|\yplan(ning)? to (end|take) my life\y';
BEGIN
  IF NEW.body IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.body ~* v_financial_solicitation THEN
    INSERT INTO p2p_content_flags (content_type, content_id, author_id, reporter_id, reason, content_snapshot)
    VALUES ('message', NEW.id, NEW.sender_id, NULL, 'Automated safety scan: possible financial solicitation', NEW.body);
  END IF;

  IF NEW.body ~* v_sexual_solicitation THEN
    INSERT INTO p2p_content_flags (content_type, content_id, author_id, reporter_id, reason, content_snapshot)
    VALUES ('message', NEW.id, NEW.sender_id, NULL, 'Automated safety scan: possible sexual solicitation', NEW.body);
  END IF;

  IF NEW.body ~* v_self_harm THEN
    INSERT INTO p2p_content_flags (content_type, content_id, author_id, reporter_id, reason, content_snapshot)
    VALUES ('message', NEW.id, NEW.sender_id, NULL, 'Automated safety scan: possible self-harm risk language', NEW.body);

    INSERT INTO p2p_help_requests (user_id, tier, category, note, status)
    VALUES (
      NEW.sender_id,
      'crisis',
      'auto_detected_message',
      'Automated detection: a message this person sent may indicate they are going through something serious.',
      'open'
    );

    NEW.flagged_self_harm := true;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;
