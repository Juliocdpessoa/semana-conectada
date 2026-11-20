CREATE TABLE IF NOT EXISTS public.app_access_diagnostics(
 id uuid PRIMARY KEY,received_at timestamptz NOT NULL DEFAULT now(),client_id uuid NOT NULL,
 actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,worksite_id uuid REFERENCES public.worksites(id) ON DELETE SET NULL,
 stage text NOT NULL CHECK(stage IN ('session','identity','password','profile','roles','worksite','membership','runtime')),
 category text NOT NULL CHECK(category IN ('network','timeout','auth','server','missing','runtime')),
 route text NOT NULL CHECK(route IN ('login','password','home','activities','other')),
 build text NOT NULL CHECK(build='access-diag-20261119-v1'),
 attempts integer NOT NULL CHECK(attempts BETWEEN 1 AND 2),
 elapsed_ms integer NOT NULL CHECK(elapsed_ms BETWEEN 0 AND 60000),
 frames text[] NOT NULL DEFAULT '{}' CHECK(cardinality(frames)<=4)
);
CREATE INDEX IF NOT EXISTS app_access_diagnostics_received_idx ON public.app_access_diagnostics(received_at DESC);
CREATE INDEX IF NOT EXISTS app_access_diagnostics_client_idx ON public.app_access_diagnostics(client_id,received_at DESC);
ALTER TABLE public.app_access_diagnostics ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_access_diagnostics FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.app_access_diagnostics TO authenticated;
GRANT ALL ON public.app_access_diagnostics TO service_role;
DROP POLICY IF EXISTS app_access_diagnostics_admin_read ON public.app_access_diagnostics;
CREATE POLICY app_access_diagnostics_admin_read ON public.app_access_diagnostics FOR SELECT TO authenticated
 USING(public.password_access_allowed() AND (public.is_global_admin(auth.uid()) OR (worksite_id IS NOT NULL AND public.has_role(auth.uid(),'admin') AND public.can_access_worksite(auth.uid(),worksite_id))));
CREATE OR REPLACE FUNCTION public.record_app_access_diagnostic(
 p_id uuid,p_client_id uuid,p_stage text,p_category text,p_route text,p_build text,p_attempts integer,p_elapsed_ms integer,p_frames text[],p_actor uuid DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $$
DECLARE site uuid; actor uuid;
BEGIN
 IF p_id IS NULL OR p_client_id IS NULL OR p_stage IS NULL OR p_category IS NULL OR p_route IS NULL OR p_build IS DISTINCT FROM 'access-diag-20261119-v1'
 OR p_stage NOT IN ('session','identity','password','profile','roles','worksite','membership','runtime')
 OR p_category NOT IN ('network','timeout','auth','server','missing','runtime')
 OR p_route NOT IN ('login','password','home','activities','other') OR p_attempts IS NULL OR p_attempts NOT BETWEEN 1 AND 2
 OR p_elapsed_ms IS NULL OR p_elapsed_ms NOT BETWEEN 0 AND 60000 OR p_frames IS NULL OR cardinality(p_frames)>4
 OR EXISTS(SELECT 1 FROM unnest(p_frames) f WHERE f IS NULL OR length(f)>150 OR f!~'^/assets/[a-zA-Z0-9_.-]+[.]js:[0-9]+:[0-9]+$') THEN RETURN false; END IF;
 -- Low-volume diagnostics only; never block access waiting for telemetry.
 IF NOT pg_try_advisory_xact_lock(hashtext('nexo_access_diagnostics_rate_limit')) THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM public.app_access_diagnostics WHERE id=p_id) THEN RETURN true; END IF;
 IF (SELECT count(*) FROM public.app_access_diagnostics WHERE received_at>now()-interval '1 minute')>=300
 OR (SELECT count(*) FROM public.app_access_diagnostics WHERE client_id=p_client_id AND received_at>now()-interval '10 minutes')>=6 THEN RETURN false; END IF;
 SELECT id,worksite_id INTO actor,site FROM public.profiles WHERE id=p_actor;
 INSERT INTO public.app_access_diagnostics(id,client_id,actor_id,worksite_id,stage,category,route,build,attempts,elapsed_ms,frames)
 VALUES(p_id,p_client_id,actor,site,p_stage,p_category,p_route,p_build,p_attempts,p_elapsed_ms,p_frames);
 DELETE FROM public.app_access_diagnostics WHERE received_at<now()-interval '30 days';
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.record_app_access_diagnostic(uuid,uuid,text,text,text,text,integer,integer,text[],uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_app_access_diagnostic(uuid,uuid,text,text,text,text,integer,integer,text[],uuid) TO service_role;
COMMENT ON TABLE public.app_access_diagnostics IS 'Access troubleshooting only. No passwords, tokens, email, raw messages, full URLs or IP. 30-day retention; six reports/client/10min and 300/min globally.';
