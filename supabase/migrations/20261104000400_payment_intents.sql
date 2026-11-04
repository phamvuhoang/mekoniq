-- W10-T02: payment-provider intents. Money is "captured" only after a verified webhook AND an authoritative query agree with the intent we created; anything else stays visible as unapplied.
CREATE TABLE public.payment_merchant (
 organization_id text NOT NULL,venue_id text NOT NULL,profile_id text NOT NULL,merchant_id text NOT NULL,payee_bin text,payee_account text,created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,venue_id,profile_id)
);
CREATE TABLE public.payment_intent (
 organization_id text NOT NULL,venue_id text NOT NULL,intent_id uuid NOT NULL,bill_id text NOT NULL,profile_id text NOT NULL,merchant_id text NOT NULL,
 amount_minor numeric(30,0) NOT NULL CHECK(amount_minor>0),currency text NOT NULL,provider_ref text,qr_payload text,
 status text NOT NULL DEFAULT 'created' CHECK(status IN('created','pending','captured','unapplied','failed','expired','unknown')),
 captured_minor numeric(30,0) NOT NULL DEFAULT 0,transaction_id text,venue_operation_id text,venue_status text,attention text,
 refunded_minor numeric(30,0) NOT NULL DEFAULT 0,refund_id text,refund_minor numeric(30,0),refund_status text CHECK(refund_status IS NULL OR refund_status IN('pending','unknown','confirmed','rejected')),
 expires_at timestamptz NOT NULL,created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,venue_id,intent_id),CHECK(refunded_minor<=captured_minor)
);
CREATE UNIQUE INDEX payment_intent_by_id ON public.payment_intent(intent_id);
CREATE TABLE public.payment_provider_event (
 profile_id text NOT NULL,event_id text NOT NULL,organization_id text NOT NULL,venue_id text NOT NULL,intent_id uuid NOT NULL,outcome text NOT NULL DEFAULT 'received',received_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(profile_id,event_id)
);
-- A provider webhook carries only our own intent reference: this definer function is the one door from it to its tenant.
CREATE FUNCTION public.payment_intent_lookup(p_intent_id uuid)
RETURNS TABLE(organization_id text,venue_id text,profile_id text) LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT i.organization_id,i.venue_id,i.profile_id FROM public.payment_intent i WHERE i.intent_id=p_intent_id
$$;
REVOKE ALL ON FUNCTION public.payment_intent_lookup(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.payment_intent_lookup(uuid) TO mekoniq_app;
DO $$ DECLARE tbl text; BEGIN
 FOREACH tbl IN ARRAY ARRAY['payment_merchant','payment_intent','payment_provider_event'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',tbl);EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',tbl);
 EXECUTE format('CREATE POLICY scoped ON public.%I TO mekoniq_app USING (organization_id=current_setting(''app.organization_id'',true) AND venue_id=current_setting(''app.venue_id'',true)) WITH CHECK (organization_id=current_setting(''app.organization_id'',true) AND venue_id=current_setting(''app.venue_id'',true))',tbl);
 EXECUTE format('GRANT SELECT,INSERT,UPDATE ON public.%I TO mekoniq_app',tbl);EXECUTE format('REVOKE ALL ON public.%I FROM anon,authenticated',tbl);
 END LOOP;
END $$;
