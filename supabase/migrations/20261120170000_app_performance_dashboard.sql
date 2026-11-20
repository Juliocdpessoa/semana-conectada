-- Isolated operational telemetry; no business rows or permissions are changed.
CREATE TABLE public.app_performance_samples (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), received_at timestamptz NOT NULL DEFAULT now(),
 actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
 worksite_id uuid REFERENCES public.worksites(id) ON DELETE SET NULL,
 operation text NOT NULL CHECK(operation IN ('activities_list','activities_filter')),
 duration_ms integer NOT NULL CHECK(duration_ms BETWEEN 0 AND 120000),
 success boolean NOT NULL, build text NOT NULL CHECK(build='performance-v1')
);
CREATE INDEX app_performance_time_idx ON public.app_performance_samples(received_at DESC);
CREATE INDEX app_performance_actor_idx ON public.app_performance_samples(actor_id,received_at DESC);
ALTER TABLE public.app_performance_samples ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_performance_samples FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.app_performance_samples TO service_role;

CREATE FUNCTION public.record_app_performance(p_operation text,p_duration_ms integer,p_success boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid:=auth.uid(); site uuid;
BEGIN
 IF actor IS NULL OR NOT public.password_access_allowed() OR NOT public.is_approved(actor)
 OR p_operation IS NULL OR p_operation NOT IN ('activities_list','activities_filter')
 OR p_duration_ms IS NULL OR p_duration_ms NOT BETWEEN 0 AND 120000 OR p_success IS NULL THEN RETURN false; END IF;
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

CREATE FUNCTION public.get_app_performance_dashboard(p_hours integer DEFAULT 24)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET statement_timeout='5s' AS $$
DECLARE actor uuid:=auth.uid(); site uuid; global_scope boolean; since_at timestamptz; result jsonb;
BEGIN
 IF actor IS NULL OR NOT public.password_access_allowed() OR NOT public.is_approved(actor)
 OR NOT (public.is_global_admin(actor) OR public.has_role(actor,'admin')) THEN
 RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Acesso restrito à administração'; END IF;
 IF p_hours IS NULL OR p_hours NOT IN (1,6,24) THEN
 RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Período inválido'; END IF;
 SELECT worksite_id INTO site FROM public.profiles WHERE id=actor;
 global_scope:=public.is_global_admin(actor);
 IF NOT global_scope AND (site IS NULL OR NOT public.can_access_worksite(actor,site)) THEN
 RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Obra sem acesso'; END IF;
 since_at:=now()-make_interval(hours=>p_hours);
 WITH errors AS MATERIALIZED (
  SELECT * FROM public.app_access_diagnostics WHERE received_at>=since_at
  AND (global_scope OR worksite_id=site)
 ), samples AS MATERIALIZED (
  SELECT * FROM public.app_performance_samples WHERE received_at>=since_at
  AND (global_scope OR worksite_id=site)
 ), hourly AS (
  SELECT date_trunc('hour',received_at) AS bucket,count(*) AS errors FROM errors GROUP BY 1
 ), groups AS (
  SELECT stage,category,realtime_reason,count(*) AS total FROM errors GROUP BY 1,2,3
 ), metrics AS (
  SELECT operation,count(*) AS samples,count(*) FILTER(WHERE NOT success) AS failures,
  round((percentile_cont(.5) WITHIN GROUP(ORDER BY duration_ms) FILTER(WHERE success))::numeric) AS median_ms,
  round((percentile_cont(.95) WITHIN GROUP(ORDER BY duration_ms) FILTER(WHERE success))::numeric) AS p95_ms
  FROM samples GROUP BY operation
 )
 SELECT jsonb_build_object(
  'checkedAt',now(),'since',since_at,'hours',p_hours,'globalScope',global_scope,
  'diagnostics',jsonb_build_object('total',(SELECT count(*) FROM errors),
   'browsers',(SELECT count(DISTINCT client_id) FROM errors),
   'realtime',(SELECT count(*) FROM errors WHERE stage='realtime')),
  'hourly',coalesce((SELECT jsonb_agg(jsonb_build_object('hour',b.bucket,'errors',coalesce(h.errors,0)) ORDER BY b.bucket)
   FROM generate_series(date_trunc('hour',since_at),date_trunc('hour',now()),interval '1 hour') b(bucket)
   LEFT JOIN hourly h ON h.bucket=b.bucket),'[]'::jsonb),
  'groups',coalesce((SELECT jsonb_agg(to_jsonb(g) ORDER BY g.total DESC) FROM groups g),'[]'::jsonb),
  'metrics',coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.operation) FROM metrics m),'[]'::jsonb),
  'recent',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.received_at DESC) FROM
   (SELECT id,received_at,stage,category,route,realtime_reason,build FROM errors ORDER BY received_at DESC LIMIT 30) r),'[]'::jsonb),
  'database',CASE WHEN global_scope THEN jsonb_build_object(
   'lockWaits',(SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'),
   'slowRequests',(SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND usename='authenticator' AND state='active' AND query_start<now()-interval '5 seconds'),
   'activeSlots',(SELECT count(*) FROM pg_replication_slots WHERE database=current_database() AND active),
   'totalSlots',(SELECT count(*) FROM pg_replication_slots WHERE database=current_database())) ELSE NULL END
 ) INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.get_app_performance_dashboard(integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_app_performance_dashboard(integer) TO authenticated;
COMMENT ON TABLE public.app_performance_samples IS 'Sampled client-observed RPC duration, not uptime or full page rendering. No payloads, filter values, URLs or credentials. Seven-day rolling retention; bounded inserts.';
