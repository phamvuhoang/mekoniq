-- Deleted objects leave a terminal manifest; every uncollected reservation remains
-- charged while a signed upload URL or physical object may still exist.
ALTER TABLE public.asset_manifest DROP CONSTRAINT asset_manifest_status_check;
ALTER TABLE public.asset_manifest ADD CONSTRAINT asset_manifest_status_check
 CHECK(status IN('pending','ready','missing','rejected','collected'));
CREATE OR REPLACE FUNCTION public.project_storage_reserved_bytes() RETURNS bigint
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
 AS $$ SELECT coalesce(sum(expected_bytes),0)::bigint FROM public.asset_manifest WHERE status<>'collected' $$;
REVOKE ALL ON FUNCTION public.project_storage_reserved_bytes() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.project_storage_reserved_bytes() TO mekoniq_app;
