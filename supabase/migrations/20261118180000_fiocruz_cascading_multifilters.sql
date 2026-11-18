CREATE OR REPLACE FUNCTION public.continuous_filter_matches(p_data jsonb,p_filters jsonb,p_exclude text DEFAULT NULL) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
SELECT NOT EXISTS(SELECT 1 FROM jsonb_each(coalesce(p_filters,'{}')) f WHERE f.key IS DISTINCT FROM p_exclude AND CASE
 WHEN jsonb_typeof(f.value)='array' THEN jsonb_array_length(f.value)>0 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(f.value) v WHERE v=coalesce(p_data->>f.key,''))
 WHEN jsonb_typeof(f.value)='string' THEN coalesce(f.value#>>'{}','')<>'' AND coalesce(p_data->>f.key,'')<>(f.value#>>'{}')
 ELSE true END);
$$;
REVOKE ALL ON FUNCTION public.continuous_filter_matches(jsonb,jsonb,text) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.continuous_activity_status_counts(p_worksite uuid, p_search text DEFAULT ''::text, p_filters jsonb DEFAULT '{}'::jsonb, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE result jsonb;
BEGIN
 IF NOT coalesce(public.password_access_allowed(),false) OR NOT coalesce(public.is_approved(auth.uid()),false) OR NOT coalesce(public.can_access_worksite(auth.uid(),p_worksite),false) THEN RAISE EXCEPTION 'Sem acesso'; END IF;
 IF jsonb_typeof(p_filters)<>'object' OR length(coalesce(p_search,''))>300 OR length(p_filters::text)>100000 THEN RAISE EXCEPTION 'Filtros inválidos'; END IF;
 SELECT coalesce(jsonb_object_agg(status,total),'{}') INTO result FROM(
 SELECT a.data->>'status' status,count(*) total FROM public.continuous_activities a
 WHERE a.worksite_id=p_worksite
 AND (coalesce(btrim(p_search),'')='' OR EXISTS(SELECT 1 FROM unnest(ARRAY['os','ss','budget','description','requester']) k WHERE position(lower(p_search) IN lower(coalesce(a.data->>k,'')))>0))
 AND public.continuous_filter_matches(a.data,p_filters,'status')
 AND (p_from IS NULL OR a.data->>'requested_date'>=p_from::text)
 AND (p_to IS NULL OR a.data->>'requested_date'<=p_to::text)
 GROUP BY 1) q;
 RETURN result;
END $function$
;
CREATE OR REPLACE FUNCTION public.continuous_activity_facets(p_worksite uuid,p_search text DEFAULT '',p_filters jsonb DEFAULT '{}',p_from date DEFAULT NULL,p_to date DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 IF NOT coalesce(public.password_access_allowed(),false) OR NOT coalesce(public.is_approved(auth.uid()),false) OR NOT coalesce(public.can_access_worksite(auth.uid(),p_worksite),false) THEN RAISE EXCEPTION 'Sem acesso'; END IF;
 IF jsonb_typeof(p_filters)<>'object' OR length(coalesce(p_search,''))>300 OR length(p_filters::text)>100000 THEN RAISE EXCEPTION 'Filtros inválidos'; END IF;
 WITH base AS MATERIALIZED (
 SELECT a.data FROM public.continuous_activities a WHERE a.worksite_id=p_worksite
 AND (coalesce(btrim(p_search),'')='' OR EXISTS(SELECT 1 FROM unnest(ARRAY['os','ss','budget','description','requester']) k WHERE position(lower(p_search) IN lower(coalesce(a.data->>k,'')))>0))
 AND (p_from IS NULL OR a.data->>'requested_date'>=p_from::text) AND (p_to IS NULL OR a.data->>'requested_date'<=p_to::text)
 ), fields AS (
 SELECT f->>'key' key FROM public.activity_page_configs c CROSS JOIN LATERAL jsonb_array_elements(c.fields) f WHERE c.worksite_id=p_worksite AND coalesce((f->>'filter')::boolean,false)
 )
 SELECT coalesce(jsonb_object_agg(f.key,coalesce((SELECT jsonb_agg(value ORDER BY value) FROM (SELECT DISTINCT b.data->>f.key value FROM base b WHERE nullif(b.data->>f.key,'') IS NOT NULL AND public.continuous_filter_matches(b.data,p_filters,f.key) ORDER BY 1 LIMIT 2000) options),'[]')),'{}') INTO result FROM fields f;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.continuous_activity_facets(uuid,text,jsonb,date,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.continuous_activity_facets(uuid,text,jsonb,date,date) TO authenticated;
