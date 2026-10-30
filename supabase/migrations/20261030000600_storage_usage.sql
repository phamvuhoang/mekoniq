INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES('mekoniq-private','mekoniq-private',false,20971520,ARRAY['image/png','image/jpeg','image/webp','application/pdf','text/csv','application/json']) ON CONFLICT(id) DO NOTHING;
CREATE TABLE public.asset_manifest (
 organization_id text NOT NULL,venue_id text NOT NULL,id text NOT NULL,kind text NOT NULL,object_path text NOT NULL UNIQUE,
 expected_bytes bigint NOT NULL CHECK(expected_bytes>0 AND expected_bytes<=20971520),mime text NOT NULL,expected_hash text NOT NULL,
 status text NOT NULL CHECK(status IN('pending','ready','missing','rejected')),created_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL,verified_at timestamptz,referenced boolean NOT NULL DEFAULT false,
 PRIMARY KEY(organization_id,venue_id,id)
);
CREATE TABLE public.cloud_usage (
 organization_id text NOT NULL,venue_id text NOT NULL,metric text NOT NULL,used numeric(40,0),source text NOT NULL,
 measured_at timestamptz NOT NULL DEFAULT now(),is_estimate boolean NOT NULL DEFAULT true,
 PRIMARY KEY(organization_id,venue_id,metric)
);
DO $$ DECLARE tbl text; BEGIN
 FOREACH tbl IN ARRAY ARRAY['asset_manifest','cloud_usage'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',tbl);EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',tbl);
 EXECUTE format('CREATE POLICY scoped ON public.%I TO mekoniq_app USING (organization_id=current_setting(''app.organization_id'',true) AND venue_id=current_setting(''app.venue_id'',true)) WITH CHECK (organization_id=current_setting(''app.organization_id'',true) AND venue_id=current_setting(''app.venue_id'',true))',tbl);
 EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO mekoniq_app',tbl);EXECUTE format('REVOKE ALL ON public.%I FROM anon,authenticated',tbl);
 END LOOP;
END $$;
CREATE FUNCTION public.project_storage_reserved_bytes() RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT coalesce(sum(expected_bytes),0)::bigint FROM public.asset_manifest WHERE status IN('ready','pending') $$;
REVOKE ALL ON FUNCTION public.project_storage_reserved_bytes() FROM PUBLIC;GRANT EXECUTE ON FUNCTION public.project_storage_reserved_bytes() TO mekoniq_app;
CREATE POLICY mekoniq_private_assets ON storage.objects FOR SELECT TO authenticated USING(bucket_id='mekoniq-private' AND public.can_subscribe_venue('venue:'||(storage.foldername(name))[1]||':'||(storage.foldername(name))[2],auth.uid()));
