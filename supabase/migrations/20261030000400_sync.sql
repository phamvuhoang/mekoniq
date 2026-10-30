CREATE TABLE public.sync_inbox (
 organization_id text NOT NULL,venue_id text NOT NULL,device_id text NOT NULL,device_epoch text NOT NULL,producer_sequence numeric(40,0) NOT NULL CHECK(producer_sequence>0),
 entry_id text NOT NULL,operation_id text NOT NULL,payload_hash text NOT NULL,canonical_hash text NOT NULL,
 aggregate_type text NOT NULL,aggregate_id text NOT NULL,resulting_version integer NOT NULL,raw_entry jsonb NOT NULL,
 status text NOT NULL CHECK(status IN('pending','applied','quarantined')),reason text,received_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,venue_id,device_id,device_epoch,producer_sequence),UNIQUE(organization_id,venue_id,entry_id)
);
CREATE UNIQUE INDEX sync_operation_stage ON public.sync_inbox(organization_id,venue_id,operation_id,(raw_entry->>'kind'));
CREATE TABLE public.sync_watermark (
 organization_id text NOT NULL,venue_id text NOT NULL,device_id text NOT NULL,device_epoch text NOT NULL,
 received_cursor numeric(40,0) NOT NULL DEFAULT 0,applied_cursor numeric(40,0) NOT NULL DEFAULT 0,
 PRIMARY KEY(organization_id,venue_id,device_id,device_epoch)
);
CREATE TABLE public.sync_projection (
 organization_id text NOT NULL,venue_id text NOT NULL,aggregate_type text NOT NULL,aggregate_id text NOT NULL,
 version integer NOT NULL,state jsonb NOT NULL,entry_id text NOT NULL,
 PRIMARY KEY(organization_id,venue_id,aggregate_type,aggregate_id)
);
DO $$ DECLARE tbl text; BEGIN
 FOREACH tbl IN ARRAY ARRAY['sync_inbox','sync_watermark','sync_projection'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',tbl);EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',tbl);
 EXECUTE format('CREATE POLICY scoped ON public.%I TO mekoniq_app USING (organization_id=current_setting(''app.organization_id'',true) AND venue_id=current_setting(''app.venue_id'',true)) WITH CHECK (organization_id=current_setting(''app.organization_id'',true) AND venue_id=current_setting(''app.venue_id'',true))',tbl);
 EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO mekoniq_app',tbl);EXECUTE format('REVOKE ALL ON public.%I FROM anon,authenticated',tbl);
 END LOOP;
END $$;
