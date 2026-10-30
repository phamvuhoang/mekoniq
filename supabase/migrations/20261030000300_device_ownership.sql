CREATE TABLE public.device_enrollment (
 organization_id text NOT NULL,venue_id text NOT NULL,device_id text NOT NULL,device_epoch text NOT NULL,
 public_jwk jsonb NOT NULL,status text NOT NULL CHECK(status IN('active','revoked')),enrolled_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,venue_id,device_id,device_epoch),FOREIGN KEY(organization_id,venue_id) REFERENCES public.venue(organization_id,id)
);
ALTER TABLE public.device_enrollment ADD COLUMN IF NOT EXISTS certificate_fingerprint text;
CREATE TABLE public.enrollment_nonce (
 organization_id text NOT NULL,venue_id text NOT NULL,nonce_hash text NOT NULL,issuer_id text NOT NULL,expires_at timestamptz NOT NULL,used_at timestamptz,
 PRIMARY KEY(organization_id,venue_id,nonce_hash)
);
CREATE TABLE public.venue_ownership (
 organization_id text NOT NULL,venue_id text NOT NULL,resource_id text NOT NULL,owner_device_id text,
 epoch bigint NOT NULL DEFAULT 1 CHECK(epoch>0),status text NOT NULL DEFAULT 'unassigned',checkpoint_hash text,
 PRIMARY KEY(organization_id,venue_id,resource_id)
);
ALTER TABLE public.venue_ownership ADD COLUMN IF NOT EXISTS owner_device_epoch text;
CREATE TABLE public.device_request_nonce (
 organization_id text NOT NULL,venue_id text NOT NULL,device_id text NOT NULL,nonce text NOT NULL,expires_at timestamptz NOT NULL,
 PRIMARY KEY(organization_id,venue_id,device_id,nonce)
);
CREATE TABLE public.configuration_revision (
 organization_id text NOT NULL,venue_id text NOT NULL,revision integer NOT NULL,features jsonb NOT NULL,
 status text NOT NULL CHECK(status IN('published','applied')),published_by text NOT NULL,published_at timestamptz NOT NULL DEFAULT now(),applied_at timestamptz,
 PRIMARY KEY(organization_id,venue_id,revision)
);
DO $$ DECLARE tbl text; BEGIN
 FOREACH tbl IN ARRAY ARRAY['device_enrollment','enrollment_nonce','venue_ownership','device_request_nonce','configuration_revision'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',tbl);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',tbl);
  EXECUTE format('CREATE POLICY scoped ON public.%I TO mekoniq_app USING (organization_id=current_setting(''app.organization_id'',true) AND venue_id=current_setting(''app.venue_id'',true)) WITH CHECK (organization_id=current_setting(''app.organization_id'',true) AND venue_id=current_setting(''app.venue_id'',true))',tbl);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO mekoniq_app',tbl);
  EXECUTE format('REVOKE ALL ON public.%I FROM anon,authenticated',tbl);
 END LOOP;
END $$;
