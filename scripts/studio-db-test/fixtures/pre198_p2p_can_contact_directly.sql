CREATE OR REPLACE FUNCTION public.p2p_can_contact_directly(p_user_a uuid, p_user_b uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  role_a text;
BEGIN
  IF p_user_a IS NULL OR p_user_b IS NULL OR p_user_a = p_user_b THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1 FROM p2p_user_blocks b
    WHERE (b.blocker_id = p_user_a AND b.blocked_id = p_user_b)
       OR (b.blocker_id = p_user_b AND b.blocked_id = p_user_a)
  ) THEN
    RETURN false;
  END IF;

  SELECT role INTO role_a FROM p2p_profiles WHERE id = p_user_a;

  IF role_a = 'super_admin' THEN
    RETURN true;
  END IF;

  IF role_a IN ('church_leader', 'regional_admin', 'moderator', 'peer_guide', 'admin_help') AND EXISTS (
    SELECT 1 FROM p2p_help_requests hr WHERE hr.user_id = p_user_b
  ) THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1 FROM p2p_group_members gm1
    JOIN p2p_group_members gm2 ON gm1.group_id = gm2.group_id
    WHERE gm1.user_id = p_user_a AND gm2.user_id = p_user_b
  ) THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1 FROM p2p_discipleship_links dl
    WHERE dl.active = true
      AND ((dl.mentor_id = p_user_a AND dl.disciple_id = p_user_b)
        OR (dl.mentor_id = p_user_b AND dl.disciple_id = p_user_a))
  ) THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1 FROM p2p_connection_requests cr
    WHERE cr.status = 'accepted' AND cr.request_type = 'connect'
      AND ((cr.from_user_id = p_user_a AND cr.to_user_id = p_user_b)
        OR (cr.from_user_id = p_user_b AND cr.to_user_id = p_user_a))
  ) THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1 FROM p2p_family_members fm1
    JOIN p2p_family_members fm2 ON fm1.family_id = fm2.family_id
    WHERE fm1.user_id = p_user_a AND fm1.status = 'active'
      AND fm2.user_id = p_user_b AND fm2.status = 'active'
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$function$
