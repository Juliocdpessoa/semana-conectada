-- Read-only, caller-RLS revision probe; metadata-only health samples.
CREATE INDEX IF NOT EXISTS activities_recovery_probe_idx ON public.activities(worksite_id,week_id,updated_at DESC,id DESC);
CREATE OR REPLACE FUNCTION public.get_activity_revision(p_week_id uuid,p_worksite_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
 SELECT coalesce((SELECT a.id::text||':'||a.version::text||':'||a.updated_at::text
 FROM public.activities a WHERE a.week_id=p_week_id AND a.worksite_id=p_worksite_id
 ORDER BY a.updated_at DESC,a.id DESC LIMIT 1),'empty')
$$;
REVOKE ALL ON FUNCTION public.get_activity_revision(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_activity_revision(uuid,uuid) TO authenticated;
ALTER TABLE public.app_performance_samples
 DROP CONSTRAINT app_performance_samples_operation_check,
 ADD CONSTRAINT app_performance_samples_operation_check CHECK(operation IN ('activities_list','activities_filter','realtime_connect','realtime_disconnect','realtime_recovery')),
 DROP CONSTRAINT app_performance_samples_duration_ms_check,
 ADD CONSTRAINT app_performance_samples_duration_ms_check CHECK(duration_ms BETWEEN 0 AND 86400000);
CREATE OR REPLACE FUNCTION public.record_app_performance(p_operation text,p_duration_ms integer,p_success boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid:=auth.uid(); site uuid;
BEGIN
 IF actor IS NULL OR NOT public.password_access_allowed() OR NOT public.is_approved(actor)
 OR p_operation IS NULL OR p_operation NOT IN ('activities_list','activities_filter','realtime_connect','realtime_disconnect','realtime_recovery')
 OR p_duration_ms IS NULL OR p_duration_ms NOT BETWEEN 0 AND 86400000 OR p_success IS NULL THEN RETURN false; END IF;
 SELECT worksite_id INTO site FROM public.profiles WHERE id=actor;
 IF site IS NULL OR NOT public.can_access_worksite(actor,site) THEN RETURN false; END IF;
 IF NOT pg_try_advisory_xact_lock(hashtext('nexo_performance_samples')) THEN RETURN false; END IF;
 IF (SELECT count(*) FROM public.app_performance_samples WHERE received_at>now()-interval '1 minute')>=200
 OR (SELECT count(*) FROM public.app_performance_samples WHERE actor_id=actor AND received_at>now()-interval '1 minute')>=6 THEN RETURN false; END IF;
 INSERT INTO public.app_performance_samples(actor_id,worksite_id,operation,duration_ms,success,build)
 VALUES(actor,site,p_operation,p_duration_ms,p_success,'performance-v1');
 DELETE FROM public.app_performance_samples WHERE id IN
 (SELECT id FROM public.app_performance_samples WHERE received_at<now()-interval '7 days' ORDER BY received_at LIMIT 200);
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.record_app_performance(text,integer,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_app_performance(text,integer,boolean) TO authenticated;


COMMENT ON FUNCTION public.get_activity_revision(uuid,uuid) IS 'Indexed revision fingerprint only. No task content; caller table RLS remains effective.';
