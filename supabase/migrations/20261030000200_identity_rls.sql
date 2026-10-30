-- Supabase Auth owns credentials; MEKONIQ owns scoped operational memberships.
CREATE TABLE public.venue (organization_id text NOT NULL,id text NOT NULL,name text NOT NULL,PRIMARY KEY(organization_id,id));
CREATE TABLE public.venue_membership (
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, organization_id text NOT NULL,venue_id text NOT NULL,
 role text NOT NULL,active boolean NOT NULL DEFAULT true,PRIMARY KEY(user_id,organization_id,venue_id),
 FOREIGN KEY(organization_id,venue_id) REFERENCES public.venue(organization_id,id)
);
ALTER TABLE public.venue_membership ADD COLUMN IF NOT EXISTS station_ids text[] NOT NULL DEFAULT '{}';
CREATE TABLE public.auth_throttle(key_hash text PRIMARY KEY,window_start timestamptz NOT NULL,attempts integer NOT NULL);
CREATE TABLE public.session_revocation(token_hash text PRIMARY KEY,expires_at timestamptz NOT NULL);
CREATE FUNCTION public.actor_memberships(subject uuid)
RETURNS TABLE(organization_id text,venue_id text,role text,station_ids text[]) LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT organization_id,venue_id,role,station_ids FROM public.venue_membership
 WHERE user_id=subject AND active=true AND subject::text=current_setting('app.actor_id',true)
$$;
REVOKE ALL ON FUNCTION public.actor_memberships(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.actor_memberships(uuid) TO mekoniq_app;
ALTER TABLE public.venue ENABLE ROW LEVEL SECURITY; ALTER TABLE public.venue FORCE ROW LEVEL SECURITY;
ALTER TABLE public.venue_membership ENABLE ROW LEVEL SECURITY; ALTER TABLE public.venue_membership FORCE ROW LEVEL SECURITY;
CREATE POLICY venue_scope ON public.venue TO mekoniq_app USING(organization_id=current_setting('app.organization_id',true) AND id=current_setting('app.venue_id',true)) WITH CHECK(organization_id=current_setting('app.organization_id',true) AND id=current_setting('app.venue_id',true));
CREATE POLICY membership_scope ON public.venue_membership TO mekoniq_app USING(organization_id=current_setting('app.organization_id',true) AND venue_id=current_setting('app.venue_id',true));
GRANT SELECT,INSERT,UPDATE ON public.venue,public.venue_membership TO mekoniq_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.auth_throttle,public.session_revocation TO mekoniq_app;
REVOKE ALL ON public.venue,public.venue_membership,public.auth_throttle,public.session_revocation FROM anon,authenticated;
