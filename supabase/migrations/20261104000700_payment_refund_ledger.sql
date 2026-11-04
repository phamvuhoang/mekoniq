-- W10-T02 review: every refund is its own row (idempotency + counted-once), the money actually captured keeps its own currency, and closed intents are re-checked for late captures.
CREATE TABLE public.payment_refund (
 organization_id text NOT NULL,venue_id text NOT NULL,refund_id text NOT NULL,intent_id uuid NOT NULL,amount_minor numeric(30,0) NOT NULL CHECK(amount_minor>0),
 status text NOT NULL CHECK(status IN('pending','unknown','confirmed','rejected')),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,venue_id,refund_id),FOREIGN KEY(organization_id,venue_id,intent_id) REFERENCES public.payment_intent(organization_id,venue_id,intent_id)
);
ALTER TABLE public.payment_refund ENABLE ROW LEVEL SECURITY;ALTER TABLE public.payment_refund FORCE ROW LEVEL SECURITY;
CREATE POLICY scoped ON public.payment_refund TO mekoniq_app USING (organization_id=current_setting('app.organization_id',true) AND venue_id=current_setting('app.venue_id',true)) WITH CHECK (organization_id=current_setting('app.organization_id',true) AND venue_id=current_setting('app.venue_id',true));
GRANT SELECT,INSERT,UPDATE,DELETE ON public.payment_refund TO mekoniq_app;REVOKE ALL ON public.payment_refund FROM anon,authenticated;
INSERT INTO public.payment_refund(organization_id,venue_id,refund_id,intent_id,amount_minor,status) SELECT organization_id,venue_id,refund_id,intent_id,refund_minor,refund_status FROM public.payment_intent WHERE refund_id IS NOT NULL AND refund_minor IS NOT NULL AND refund_status IS NOT NULL;
ALTER TABLE public.payment_intent ADD COLUMN captured_currency text,ADD COLUMN late_checked_at timestamptz;
UPDATE public.payment_intent SET captured_currency=currency WHERE captured_minor>0;
