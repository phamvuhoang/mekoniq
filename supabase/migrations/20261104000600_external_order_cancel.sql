-- W10-T04: a channel may ask to cancel; the venue decides under the normal order-cancel rules.
ALTER TABLE public.external_order DROP CONSTRAINT external_order_status_check;
ALTER TABLE public.external_order ADD CONSTRAINT external_order_status_check CHECK(status IN('received','accepted','rejected','expired','cancelled'));
ALTER TABLE public.external_order ADD COLUMN cancel_status text CHECK(cancel_status IS NULL OR cancel_status IN('pending','refused','done')),ADD COLUMN cancel_code text,ADD COLUMN cancel_operation_id text;
