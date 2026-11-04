-- W09-T02: a pool several branches draw on. The cloud is the only place the pool is decremented; a branch spends only the exact allocation it was granted.
CREATE TABLE public.chain_shared_balance (
 organization_id text NOT NULL,balance_id text NOT NULL,voucher_id text NOT NULL,total integer NOT NULL CHECK(total>0),available integer NOT NULL CHECK(available>=0),
 created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(organization_id,balance_id),CHECK(available<=total)
);
CREATE TABLE public.chain_shared_grant (
 organization_id text NOT NULL,balance_id text NOT NULL,venue_id text NOT NULL,
 granted integer NOT NULL DEFAULT 0 CHECK(granted>=0),returned integer NOT NULL DEFAULT 0 CHECK(returned>=0),revision integer NOT NULL DEFAULT 0,
 return_revision integer NOT NULL DEFAULT 0,pending_return integer NOT NULL DEFAULT 0,return_operation_id text,
 PRIMARY KEY(organization_id,balance_id,venue_id),FOREIGN KEY(organization_id,balance_id) REFERENCES public.chain_shared_balance(organization_id,balance_id),CHECK(returned<=granted)
);
CREATE TABLE public.chain_shared_operation (
 organization_id text NOT NULL,balance_id text NOT NULL,operation_id text NOT NULL,venue_id text NOT NULL,count integer NOT NULL,revision integer NOT NULL,
 PRIMARY KEY(organization_id,balance_id,operation_id)
);
DO $$ DECLARE tbl text; BEGIN
 FOREACH tbl IN ARRAY ARRAY['chain_shared_balance','chain_shared_grant','chain_shared_operation'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',tbl);EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',tbl);
 EXECUTE format('CREATE POLICY org_scope ON public.%I TO mekoniq_app USING (organization_id=current_setting(''app.organization_id'',true)) WITH CHECK (organization_id=current_setting(''app.organization_id'',true))',tbl);
 EXECUTE format('GRANT SELECT,INSERT,UPDATE ON public.%I TO mekoniq_app',tbl);EXECUTE format('REVOKE ALL ON public.%I FROM anon,authenticated',tbl);
 END LOOP;
END $$;
