-- Diagnostic metadata only. No activity/account/permission changes.
ALTER TABLE public.app_access_diagnostics
 ADD COLUMN IF NOT EXISTS realtime_reason text;
ALTER TABLE public.app_access_diagnostics
 DROP CONSTRAINT IF EXISTS app_access_diagnostics_stage_check,
 ADD CONSTRAINT app_access_diagnostics_stage_check CHECK(stage IN
 ('session','identity','password','profile','roles','worksite','membership','runtime','realtime')),
 DROP CONSTRAINT IF EXISTS app_access_diagnostics_build_check,
 ADD CONSTRAINT app_access_diagnostics_build_check CHECK(build IN
 ('access-diag-20261119-v1','access-diag-20261120-v2')),
 DROP CONSTRAINT IF EXISTS app_access_diagnostics_realtime_reason_check,
 ADD CONSTRAINT app_access_diagnostics_realtime_reason_check CHECK(realtime_reason IS NULL OR
 (stage='realtime' AND realtime_reason IN ('transport','timeout','authorization','jwt','quota','replication','closed','unknown')));

DO $migration$
DECLARE definition text;
BEGIN
 SELECT pg_get_functiondef('public.record_app_access_diagnostic(uuid,uuid,text,text,text,text,integer,integer,text[],uuid)'::regprocedure) INTO definition;
 -- Fail closed if the existing implementation is not the reviewed version.
 IF position('p_build IS DISTINCT FROM ''access-diag-20261119-v1''' in definition)>0 THEN
   definition:=replace(definition,
    'p_build IS DISTINCT FROM ''access-diag-20261119-v1''',
    'p_build IS NULL OR p_build NOT IN (''access-diag-20261119-v1'',''access-diag-20261120-v2'')');
 ELSIF position('p_build NOT IN (''access-diag-20261119-v1'',''access-diag-20261120-v2'')' in definition)=0 THEN
   RAISE EXCEPTION 'Unexpected diagnostic build guard; review before migrating';
 END IF;
 IF position('''membership'',''runtime'')' in definition)>0 THEN
   definition:=replace(definition,'''membership'',''runtime'')','''membership'',''runtime'',''realtime'')');
 ELSIF position('''membership'',''runtime'',''realtime'')' in definition)=0 THEN
   RAISE EXCEPTION 'Unexpected diagnostic stage guard; review before migrating';
 END IF;
 EXECUTE definition;
END $migration$;

CREATE OR REPLACE FUNCTION public.record_app_realtime_diagnostic(
 p_id uuid,p_client_id uuid,p_stage text,p_category text,p_route text,p_build text,
 p_attempts integer,p_elapsed_ms integer,p_frames text[],p_actor uuid,p_reason text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $$
BEGIN
 IF p_stage IS DISTINCT FROM 'realtime' OR p_reason IS NULL OR
 p_reason NOT IN ('transport','timeout','authorization','jwt','quota','replication','closed','unknown') THEN RETURN false; END IF;
 -- Reuse unchanged retention, rate caps, verified actor resolution and safe frames.
 IF NOT public.record_app_access_diagnostic(p_id,p_client_id,p_stage,p_category,p_route,p_build,p_attempts,p_elapsed_ms,p_frames,p_actor) THEN RETURN false; END IF;
 UPDATE public.app_access_diagnostics SET realtime_reason=p_reason
 WHERE id=p_id AND client_id=p_client_id AND stage='realtime' AND realtime_reason IS NULL;
 RETURN EXISTS(SELECT 1 FROM public.app_access_diagnostics
 WHERE id=p_id AND client_id=p_client_id AND stage='realtime' AND realtime_reason=p_reason);
END $$;
REVOKE ALL ON FUNCTION public.record_app_realtime_diagnostic(uuid,uuid,text,text,text,text,integer,integer,text[],uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_app_realtime_diagnostic(uuid,uuid,text,text,text,text,integer,integer,text[],uuid,text) TO service_role;
COMMENT ON COLUMN public.app_access_diagnostics.realtime_reason IS 'Fixed diagnostic classification, not a raw error or proof of network filtering. No tokens, URLs, payloads or personal text.';
