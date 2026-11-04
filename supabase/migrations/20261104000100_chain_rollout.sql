-- W09-T01: organisation-level chain configuration. Rows are scoped by organisation only (a chain spans venues); per-venue facts are still read through the venue-scoped tables.
CREATE TABLE public.chain_revision (
 organization_id text NOT NULL,revision integer NOT NULL CHECK(revision>=1),snapshot jsonb NOT NULL,restores integer,note text,
 created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(organization_id,revision)
);
CREATE TABLE public.chain_branch_override (
 organization_id text NOT NULL,venue_id text NOT NULL,revision integer NOT NULL CHECK(revision>=1),patch jsonb NOT NULL,
 created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(organization_id,venue_id,revision)
);
CREATE TABLE public.chain_rollout_target (
 organization_id text NOT NULL,revision integer NOT NULL,venue_id text NOT NULL,kind text NOT NULL CHECK(kind IN('catalog','configuration')),
 desired_version integer NOT NULL,operation_id text,status text NOT NULL CHECK(status IN('dispatched','rejected')),code text,attempts integer NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(organization_id,revision,venue_id,kind),
 FOREIGN KEY(organization_id,revision) REFERENCES public.chain_revision(organization_id,revision)
);
DO $$ DECLARE tbl text; BEGIN
 FOREACH tbl IN ARRAY ARRAY['chain_revision','chain_branch_override','chain_rollout_target'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',tbl);EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',tbl);
 EXECUTE format('CREATE POLICY org_scope ON public.%I TO mekoniq_app USING (organization_id=current_setting(''app.organization_id'',true)) WITH CHECK (organization_id=current_setting(''app.organization_id'',true))',tbl);
 EXECUTE format('GRANT SELECT,INSERT,UPDATE ON public.%I TO mekoniq_app',tbl);EXECUTE format('REVOKE ALL ON public.%I FROM anon,authenticated',tbl);
 END LOOP;
END $$;
