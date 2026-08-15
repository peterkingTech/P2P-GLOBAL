-- Voice messages storage bucket — same public-bucket + own-folder-write
-- pattern as the 'avatars' bucket (migration 012). Public rather than
-- signed-URL (unlike the 'submissions' bucket) because the actual privacy
-- boundary here is p2p_messages/p2p_conversation_members RLS — only
-- conversation members can ever read the message ROW containing a given
-- media_url in the first place, matching the same threat model already
-- accepted for avatars.
INSERT INTO storage.buckets (id, name, public)
VALUES ('voice-messages', 'voice-messages', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "voice_messages_public_read" ON storage.objects;
CREATE POLICY "voice_messages_public_read" ON storage.objects FOR SELECT
  USING (bucket_id = 'voice-messages');

DROP POLICY IF EXISTS "voice_messages_owner_write" ON storage.objects;
CREATE POLICY "voice_messages_owner_write" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'voice-messages' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "voice_messages_owner_delete" ON storage.objects;
CREATE POLICY "voice_messages_owner_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'voice-messages' AND (storage.foldername(name))[1] = auth.uid()::text);

-- p2p_messages.media_url already exists (migration 012) and already carries
-- the voice-note file; a matching duration lets playback UI show "0:14"
-- immediately without probing the audio file.
ALTER TABLE public.p2p_messages
  ADD COLUMN IF NOT EXISTS media_duration_seconds integer;