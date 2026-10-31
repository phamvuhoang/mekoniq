CREATE TABLE public.relay_command (
 organization_id text NOT NULL,venue_id text NOT NULL,operation_id text NOT NULL,payload_hash text NOT NULL,command jsonb NOT NULL,
 coordinator_epoch integer NOT NULL,status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','accepted','rejected','unknown')),
 expires_at timestamptz NOT NULL,venue_receipt jsonb,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(organization_id,venue_id,operation_id)
);
CREATE TABLE public.cloud_job (
 organization_id text NOT NULL,venue_id text NOT NULL,id text NOT NULL,type text NOT NULL,payload jsonb NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','leased','sending','unknown','confirmed','failed','dead_letter')),
 lease_owner text,lease_until timestamptz,attempts integer NOT NULL DEFAULT 0,due_at timestamptz NOT NULL DEFAULT now(),
 result jsonb,last_error text,PRIMARY KEY(organization_id,venue_id,id)
);
CREATE INDEX cloud_job_due ON public.cloud_job(status,due_at);
CREATE TABLE public.realtime_hint_budget (
 organization_id text NOT NULL,venue_id text NOT NULL,last_sent_at timestamptz,watermark text NOT NULL DEFAULT '0',
 PRIMARY KEY(organization_id,venue_id)
);
CREATE TABLE public.job_request_nonce(nonce text PRIMARY KEY,expires_at timestamptz NOT NULL);
GRANT SELECT,INSERT,DELETE ON public.job_request_nonce TO mekoniq_app;REVOKE ALL ON public.job_request_nonce FROM anon,authenticated;
DO $$ DECLARE tbl text; BEGIN
 FOREACH tbl IN ARRAY ARRAY['relay_command','cloud_job','realtime_hint_budget'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',tbl);EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',tbl);
 EXECUTE format('CREATE POLICY scoped ON public.%I TO mekoniq_app USING (organization_id=current_setting(''app.organization_id'',true) AND venue_id=current_setting(''app.venue_id'',true)) WITH CHECK (organization_id=current_setting(''app.organization_id'',true) AND venue_id=current_setting(''app.venue_id'',true))',tbl);
 EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO mekoniq_app',tbl);EXECUTE format('REVOKE ALL ON public.%I FROM anon,authenticated',tbl);
 END LOOP;
END $$;
CREATE FUNCTION public.can_subscribe_venue(topic text,subject uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.venue_membership m WHERE m.user_id=subject AND m.active AND topic='venue:'||m.organization_id||':'||m.venue_id)
$$;
REVOKE ALL ON FUNCTION public.can_subscribe_venue(text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_subscribe_venue(text,uuid) TO authenticated;
CREATE POLICY mekoniq_private_hints ON realtime.messages FOR SELECT TO authenticated USING(public.can_subscribe_venue(realtime.topic(),auth.uid()));
-- Scheduler installation is explicit: local does not need a hosted URL or vault secret.
-- Supabase Cron executes only for due work and signs each bounded venue invocation.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE FUNCTION public.wake_due_jobs() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target_url text;secret text;scope record;body text;ts text;nonce text;signature text;
BEGIN
 SELECT decrypted_secret INTO target_url FROM vault.decrypted_secrets WHERE name='mekoniq_jobs_url';
 SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name='mekoniq_jobs_hmac';
 IF target_url IS NULL OR secret IS NULL THEN RETURN; END IF;
 FOR scope IN SELECT DISTINCT organization_id,venue_id FROM public.cloud_job WHERE status IN('pending','leased','sending','unknown') AND due_at<=now() LIMIT 20 LOOP
  body:=jsonb_build_object('organizationId',scope.organization_id,'venueId',scope.venue_id)::text;
  ts:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint::text;nonce:=extensions.gen_random_uuid()::text;
  signature:=encode(extensions.hmac(convert_to(ts||'.'||nonce||'.'||body,'UTF8'),convert_to(secret,'UTF8'),'sha256'),'hex');
  PERFORM net.http_post(url:=target_url,body:=body::jsonb,headers:=jsonb_build_object('Content-Type','application/json','x-job-timestamp',ts,'x-job-nonce',nonce,'x-job-signature',signature),timeout_milliseconds:=25000);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.wake_due_jobs() FROM PUBLIC,anon,authenticated,mekoniq_app;
-- A fixed schedule is idempotently installed by the migration, but returns immediately without due jobs/credentials.
SELECT cron.schedule('mekoniq-due-jobs','* * * * *','SELECT public.wake_due_jobs()');
