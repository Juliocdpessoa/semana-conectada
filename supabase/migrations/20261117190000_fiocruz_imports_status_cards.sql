ALTER TABLE public.continuous_activities ADD COLUMN test_dataset text,ADD COLUMN source_file_name text,ADD COLUMN source_row_number integer,ADD COLUMN source_data jsonb;
CREATE FUNCTION public.continuous_activity_status_counts(p_worksite uuid,p_search text DEFAULT '',p_filters jsonb DEFAULT '{}',p_from date DEFAULT NULL,p_to date DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 IF NOT coalesce(public.password_access_allowed(),false) OR NOT coalesce(public.is_approved(auth.uid()),false) OR NOT coalesce(public.can_access_worksite(auth.uid(),p_worksite),false) THEN RAISE EXCEPTION 'Sem acesso'; END IF;
 IF jsonb_typeof(p_filters)<>'object' OR length(coalesce(p_search,''))>300 OR length(p_filters::text)>10000 THEN RAISE EXCEPTION 'Filtros inválidos'; END IF;
 SELECT coalesce(jsonb_object_agg(status,total),'{}') INTO result FROM(
 SELECT a.data->>'status' status,count(*) total FROM public.continuous_activities a
 WHERE a.worksite_id=p_worksite
 AND (coalesce(btrim(p_search),'')='' OR EXISTS(SELECT 1 FROM unnest(ARRAY['os','ss','budget','description','requester']) k WHERE position(lower(p_search) IN lower(coalesce(a.data->>k,'')))>0))
 AND NOT EXISTS(SELECT 1 FROM jsonb_each_text(p_filters) f WHERE f.key<>'status' AND coalesce(f.value,'')<>'' AND coalesce(a.data->>f.key,'')<>f.value)
 AND (p_from IS NULL OR a.data->>'requested_date'>=p_from::text)
 AND (p_to IS NULL OR a.data->>'requested_date'<=p_to::text)
 GROUP BY 1) q;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.continuous_activity_status_counts(uuid,text,jsonb,date,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.continuous_activity_status_counts(uuid,text,jsonb,date,date) TO authenticated;
