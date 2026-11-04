-- W10-T03: cloud-side life of an e-invoice request. The venue owns the request and the answer; this table only guards the provider call (never issue twice) and the resend of the answer.
CREATE TABLE public.invoice_request (
 organization_id text NOT NULL,venue_id text NOT NULL,request_id text NOT NULL,bill_id text NOT NULL,profile_id text NOT NULL,request_key text NOT NULL,
 status text NOT NULL DEFAULT 'draft' CHECK(status IN('draft','unknown','issued','rejected','cancelled')),attempts integer NOT NULL DEFAULT 0,
 snapshot jsonb NOT NULL,provider_invoice_id text,invoice_code text,rejection_code text,adjustments jsonb NOT NULL DEFAULT '[]',last_error text,
 venue_operation_id text,venue_status text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,venue_id,request_id),UNIQUE(profile_id,request_key)
);
DO $$ BEGIN
 ALTER TABLE public.invoice_request ENABLE ROW LEVEL SECURITY;ALTER TABLE public.invoice_request FORCE ROW LEVEL SECURITY;
 CREATE POLICY scoped ON public.invoice_request TO mekoniq_app USING (organization_id=current_setting('app.organization_id',true) AND venue_id=current_setting('app.venue_id',true)) WITH CHECK (organization_id=current_setting('app.organization_id',true) AND venue_id=current_setting('app.venue_id',true));
 GRANT SELECT,INSERT,UPDATE ON public.invoice_request TO mekoniq_app;REVOKE ALL ON public.invoice_request FROM anon,authenticated;
END $$;
