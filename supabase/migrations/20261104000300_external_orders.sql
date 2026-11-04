-- W09-T03: external channel orders. The cloud keeps the channel's request durably (`received`); only the venue's own decision makes it `accepted`.
CREATE TABLE public.channel_credential (
 key_id text PRIMARY KEY,organization_id text NOT NULL,venue_id text NOT NULL,provider_id text NOT NULL,merchant_id text NOT NULL,
 unavailable_policy text NOT NULL DEFAULT 'hold' CHECK(unavailable_policy IN('hold','reject')),status text NOT NULL DEFAULT 'active' CHECK(status IN('active','revoked')),
 created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.external_order (
 id uuid NOT NULL DEFAULT gen_random_uuid(),organization_id text NOT NULL,venue_id text NOT NULL,provider_id text NOT NULL,merchant_id text NOT NULL,external_id text NOT NULL,
 payload_hash text NOT NULL,normalized jsonb NOT NULL,status text NOT NULL DEFAULT 'received' CHECK(status IN('received','accepted','rejected','expired')),
 code text,venue_recorded boolean NOT NULL DEFAULT false,attention text,relay_operation_id text,relay_attempts integer NOT NULL DEFAULT 0,unavailable_policy text NOT NULL DEFAULT 'hold' CHECK(unavailable_policy IN('hold','reject')),
 expires_at timestamptz NOT NULL,sandbox boolean NOT NULL DEFAULT false,provider_ref text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(id)
);
CREATE UNIQUE INDEX external_order_identity ON public.external_order(organization_id,venue_id,provider_id,merchant_id,external_id);
CREATE TABLE public.external_order_conflict (
 id bigserial PRIMARY KEY,organization_id text NOT NULL,venue_id text NOT NULL,provider_id text NOT NULL,merchant_id text NOT NULL,external_id text NOT NULL,
 payload_hash text NOT NULL,raw_body text NOT NULL,received_at timestamptz NOT NULL DEFAULT now()
);
-- The key id arrives before we know the tenant: this definer function is the only door from a key id to its scope (secrets are derived from a server master, never stored).
CREATE FUNCTION public.channel_credential_lookup(p_key_id text)
RETURNS TABLE(organization_id text,venue_id text,provider_id text,merchant_id text,unavailable_policy text,status text) LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT c.organization_id,c.venue_id,c.provider_id,c.merchant_id,c.unavailable_policy,c.status FROM public.channel_credential c WHERE c.key_id=p_key_id
$$;
REVOKE ALL ON FUNCTION public.channel_credential_lookup(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.channel_credential_lookup(text) TO mekoniq_app;
DO $$ DECLARE tbl text; BEGIN
 FOREACH tbl IN ARRAY ARRAY['channel_credential','external_order','external_order_conflict'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',tbl);EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',tbl);
 EXECUTE format('CREATE POLICY scoped ON public.%I TO mekoniq_app USING (organization_id=current_setting(''app.organization_id'',true) AND venue_id=current_setting(''app.venue_id'',true)) WITH CHECK (organization_id=current_setting(''app.organization_id'',true) AND venue_id=current_setting(''app.venue_id'',true))',tbl);
 EXECUTE format('GRANT SELECT,INSERT,UPDATE ON public.%I TO mekoniq_app',tbl);EXECUTE format('REVOKE ALL ON public.%I FROM anon,authenticated',tbl);
 END LOOP;
END $$;
GRANT USAGE ON SEQUENCE public.external_order_conflict_id_seq TO mekoniq_app;
