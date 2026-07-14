-- ── Write-time message content scanning, two layers ───────────────────────────
-- Layer 1 (blocking, synchronous): a BEFORE INSERT trigger that RAISEs and
-- aborts the insert if the message matches financial-detail/wallet-address
-- patterns or common scam phrasing, or early-conversation phone/WhatsApp
-- exchange. The client already treats any insert error as "message didn't
-- send" (messages/[id].tsx keeps the draft text on error), so no new client
-- plumbing is needed to make this actually block — only better error copy.
--
-- Layer 2 (classification, never blocks): a second BEFORE INSERT trigger that
-- keyword-scans for financial solicitation, sexual solicitation, and
-- self-harm risk language. It NEVER raises — wrapped in its own exception
-- handler as a hard guarantee — and routes matches into the existing
-- moderation queue (p2p_content_flags, same table/pattern as prompts 1-2).
--
-- Both are literally regex/keyword heuristics, not an ML/LLM classifier —
-- documented here the same way the earlier trust & safety plan was honest
-- about that: this is a real, testable first pass, not exhaustive, and worth
-- upgrading to a real classifier later without needing to change the plumbing
-- around it (the flagging/notification side already doesn't care where the
-- "this looks bad" signal comes from).
--
-- Self-harm handling specifically reuses the EXISTING Tier 1 "I need help
-- now" crisis system verified still in the codebase (p2p_help_requests +
-- trg_notify_on_help_request, which already notifies every p2p_admin_roles
-- 'crisis_responder' account) rather than building a second notification
-- path. Real-time crisis resources for the at-risk user reuse the same
-- placeholder convention already used in components/HelpButton.tsx
-- ("[INSERT REGIONAL CRISIS LINE]") — same disclaimer applies: these are
-- placeholders and must be replaced with real, region-appropriate resources
-- before this reaches real users.

-- Lets the client learn "your own message was just flagged as self-harm risk"
-- in the same round trip as the send (insert().select()), rather than a
-- separate query racing the trigger.
ALTER TABLE public.p2p_messages ADD COLUMN IF NOT EXISTS flagged_self_harm boolean NOT NULL DEFAULT false;

-- ── Layer 1: blocking regex scan ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION p2p_block_message_content()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_financial_pattern text := '\biban\b' ||
    '|\b[a-z]{2}\d{2}[a-z0-9]{11,30}\b' ||                                   -- IBAN
    '|\b4[0-9]{3}[- ]?[0-9]{4}[- ]?[0-9]{4}[- ]?[0-9]{4}\b' ||               -- Visa
    '|\b5[1-5][0-9]{2}[- ]?[0-9]{4}[- ]?[0-9]{4}[- ]?[0-9]{4}\b' ||          -- Mastercard
    '|\b3[47][0-9]{2}[- ]?[0-9]{6}[- ]?[0-9]{5}\b' ||                        -- Amex
    '|\b6(?:011|5[0-9]{2})[0-9]{12}\b' ||                                    -- Discover
    '|\b0x[a-f0-9]{40}\b' ||                                                 -- ETH wallet
    '|\bbc1[a-z0-9]{25,39}\b' ||                                             -- BTC bech32 wallet
    '|\b[13][a-km-zA-HJ-NP-Z1-9]{25,34}\b' ||                                -- BTC legacy wallet
    '|\b(routing|account|acct)\s*(number|#|no\.?)\b' ||
    '|\b(swift|bic|ifsc|sort code)\b' ||
    '|\bwestern union\b|\bmoneygram\b|\bwire transfer\b|\bwire me\b|\bwire the money\b' ||
    '|\bgift card' ||
    '|\b(itunes|google play|amazon) (gift )?card\b' ||
    '|\bcash ?app me\b|\bvenmo me\b|\bzelle me\b' ||
    '|\bsend (me )?(the )?(money|funds|payment)\b';
  v_contact_pattern text := '\bwhatsapp\b|\btelegram\b|\bsignal me\b|\btext me at\b|\bcall me at\b' ||
    '|\b\+?\d{1,3}[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b';
  v_prior_message_count int;
BEGIN
  IF NEW.body IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.body ~* v_financial_pattern THEN
    RAISE EXCEPTION 'For your safety, we don''t allow sharing financial details or wallet addresses in messages.';
  END IF;

  -- Phone/WhatsApp exchange is only blocked early in a conversation — the
  -- classic move-off-platform scam precursor. Once a conversation has some
  -- history, sharing contact info is a normal, legitimate thing peers do.
  SELECT count(*) INTO v_prior_message_count FROM p2p_messages WHERE conversation_id = NEW.conversation_id;
  IF v_prior_message_count < 5 AND NEW.body ~* v_contact_pattern THEN
    RAISE EXCEPTION 'For your safety, please don''t share phone numbers or move this conversation off the app this early on.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS p2p_messages_01_block_content ON public.p2p_messages;
CREATE TRIGGER p2p_messages_01_block_content
  BEFORE INSERT ON public.p2p_messages
  FOR EACH ROW EXECUTE FUNCTION p2p_block_message_content();

-- ── Layer 2: non-blocking classification, routed to the moderation queue ─────
CREATE OR REPLACE FUNCTION p2p_classify_message_content()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_financial_solicitation text := '\bsend (me )?money\b|\bneed (financial help|money urgently)\b' ||
    '|\binvest with me\b|\bguaranteed returns?\b|\bdouble your money\b' ||
    '|\bprocessing fee\b|\badvance fee\b|\bloan (me|you)\b|\bi need \$?\d+\b';
  v_sexual_solicitation text := '\bsend (me )?nudes?\b|\bnude (photo|pic|picture)s?\b' ||
    '|\bnaked (photo|pic|picture)s?\b|\bsexy pics?\b|\bonlyfans\b';
  v_self_harm text := '\bkill myself\b|\bwant(ed)? to die\b|\bend(ing)? my life\b|\bend it all\b' ||
    '|\bsuicid(e|al)\b|\bself.?harm\b|\bcutting myself\b|\bhurt(ing)? myself\b' ||
    '|\bno reason to live\b|\bbetter off dead\b|\bcan''t go on\b|\bcant go on\b' ||
    '|\bdon''t want to (be here|live) anymore\b|\bdont want to (be here|live) anymore\b' ||
    '|\bplan(ning)? to (end|take) my life\b';
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

    -- Reuses the existing Tier 1 crisis system as-is: this INSERT fires
    -- trg_notify_on_help_request exactly the same way HelpButton.tsx's
    -- self-reported "I need help now" does, notifying every crisis_responder.
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
  -- Classification must never be able to block a send. If anything above
  -- fails for any reason, the message still goes through unflagged.
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS p2p_messages_02_classify_content ON public.p2p_messages;
CREATE TRIGGER p2p_messages_02_classify_content
  BEFORE INSERT ON public.p2p_messages
  FOR EACH ROW EXECUTE FUNCTION p2p_classify_message_content();
