-- Forensic calling audit — the moment a call actually reaches Agora's
-- onUserJoined (both real parties confirmed present in the channel, the
-- only correct definition of "connected" per this codebase's call screens)
-- has never been persisted anywhere; it only ever existed as an in-memory
-- ref and a console.log on the device. That made "did this call actually
-- connect, or did it stay stuck ringing/connecting?" impossible to see
-- without physical access to a device's logs. Purely additive, nullable —
-- no existing row or column is touched.

alter table public.p2p_call_logs
  add column if not exists connected_at timestamptz;

comment on column public.p2p_call_logs.connected_at is 'Set by POST /calls/end from the client-reported timestamp of Agora onUserJoined (see app/call/audio.tsx connectedAtRef) — null means the call never actually connected, regardless of how long it rang/attempted to connect.';