-- "Choose Someone I Know as My Peer Guide" — extends the existing
-- p2p_discipleship_links request lifecycle (pending/active/declined/expired,
-- added in 047_peer_guide_eligibility.sql) rather than a second relationship
-- system. Two additive, nullable-or-defaulted columns:
--
-- message: the requester's optional personal note, shown to the prospective
-- peer guide alongside the request (peer-guide-requests.tsx).
--
-- source: distinguishes an algorithmic Smart Match request from a direct
-- "I already know this person" ask. This matters beyond labeling — the
-- existing decline handler (PUT /discipleship/request/:linkId/respond)
-- auto-cascades a decline into a new request to the next best Smart Match
-- candidate, which is correct for 'smart_match' but wrong for 'direct': if
-- someone declines being a specific person's peer guide, the requester
-- didn't ask for an algorithmic backup, and cascading would notify a
-- stranger the requester never chose. source lets the API branch that
-- behavior correctly per-request.
ALTER TABLE public.p2p_discipleship_links
  ADD COLUMN IF NOT EXISTS message text,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'smart_match'
    CHECK (source IN ('smart_match', 'direct'));