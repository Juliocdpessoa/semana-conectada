-- Read-only RS analysis: local scope, monitoring-only Alpinismo, daily SAP evidence.
CREATE OR REPLACE FUNCTION public.weekly_rs_activity_evidence(p_week_id uuid)
RETURNS TABLE(id uuid,order_number text,operation text,suboperation text,confirmation text,description text,scheduled_date date,
  center text,local text,specialty text,included_in_rs boolean,planned_hh numeric,status text,justification text,observation text,sap_state text)
LANGUAGE sql STABLE SET search_path=public AS $$
WITH target AS (SELECT * FROM public.weeks WHERE id=p_week_id),
mapping AS (
  SELECT upper(btrim(r->>'center')) center,min(r->>'specialty') specialty,
    CASE WHEN count(DISTINCT upper(btrim(r->>'local')))=1 THEN min(upper(btrim(r->>'local'))) END local
  FROM public.weekly_rs_availability av CROSS JOIN LATERAL jsonb_array_elements(av.rows) r
  WHERE av.week_id=p_week_id AND av.worksite_id=(SELECT worksite_id FROM target) GROUP BY 1
), latest AS (
  SELECT i.id FROM public.sap_confirmation_imports i WHERE i.week_id=p_week_id AND i.worksite_id=(SELECT worksite_id FROM target)
    AND EXISTS(SELECT 1 FROM public.sap_confirmation_rows r WHERE r.import_id=i.id AND r.worksite_id=i.worksite_id)
  ORDER BY i.imported_at DESC,i.id DESC LIMIT 1
), sap AS MATERIALIZED (
  SELECT regexp_replace(regexp_replace(btrim(coalesce(s.confirmation,'')),'([,.]0+)$','','g'),'^0+','') confirmation,
    s.actual_start_date,s.actual_end_date
  FROM public.sap_confirmation_rows s WHERE s.import_id=(SELECT id FROM latest) AND s.worksite_id=(SELECT worksite_id FROM target)
    AND s.week_id=p_week_id AND s.has_confirmation AND s.actual_work>0
), program AS MATERIALIZED (
  SELECT a.*,
    upper(btrim(coalesce(nullif(a.planning_data->>'CenTrab',''),nullif(a.planning_data->>'CENTRO_DE_TRABALHO',''),nullif(a.planning_data->>'Centro de trabalho',''),a.specialty,''))) center_key,
    regexp_replace(regexp_replace(btrim(coalesce(a.planning_data->>'Confirmação',a.planning_data->>'Confirmacao','')),'([,.]0+)$','','g'),'^0+','') confirmation_key,
    CASE WHEN position(',' in h.cleaned)>0 THEN replace(replace(h.cleaned,'.',''),',','.') ELSE h.cleaned END normalized_hh
  FROM public.activities a CROSS JOIN LATERAL (
    SELECT regexp_replace(btrim(coalesce(a.planning_data->>'Trab',a.planning_data->>'TRAB',a.planning_data->>'trab','')),'\s*h(oras?)?$','','i') cleaned
  ) h WHERE a.week_id=p_week_id AND a.worksite_id=(SELECT worksite_id FROM target) AND NOT a.is_immediate
    AND (nullif(btrim(coalesce(a.order_number,'')),'') IS NOT NULL OR nullif(btrim(coalesce(a.description,'')),'') IS NOT NULL
      OR nullif(btrim(coalesce(a.planning_data->>'Confirmação',a.planning_data->>'Confirmacao','')),'') IS NOT NULL)
)
, evidence AS (
 SELECT p.id,
   coalesce(bool_or((s.actual_start_date IS NOT NULL OR s.actual_end_date IS NOT NULL)
     AND p.scheduled_date BETWEEN coalesce(s.actual_start_date,s.actual_end_date) AND coalesce(s.actual_end_date,s.actual_start_date)),false) in_period,
   coalesce(bool_or(s.confirmation IS NOT NULL AND s.actual_start_date IS NULL AND s.actual_end_date IS NULL),false) unknown_period
 FROM program p LEFT JOIN sap s ON s.confirmation=p.confirmation_key AND p.confirmation_key<>'' GROUP BY p.id
)
SELECT p.id,p.order_number::text,p.planning_data->>'Op',p.planning_data->>'Subop',p.confirmation_key,p.description::text,p.scheduled_date,
  p.center_key,coalesce(nullif(upper(btrim(p.planning_data->>'Local')),''),m.local,'SEM LOCAL'),coalesce(m.specialty,'Sem vínculo'),
  upper(btrim(coalesce(m.specialty,''))) NOT IN ('ALPINISTA','ALPINISTAS','ALPINISMO'),
  CASE WHEN p.normalized_hh ~ '^[0-9]+(\.[0-9]+)?$' THEN p.normalized_hh::numeric END,p.status::text,
  nullif(btrim(p.justification),''),p.observation::text,
  CASE WHEN NOT EXISTS(SELECT 1 FROM latest) THEN 'sem_carga'
    WHEN p.confirmation_key='' THEN 'sem_confirmacao'
    WHEN e.in_period THEN 'apropriada'
    WHEN e.unknown_period THEN 'periodo_indefinido'
    ELSE 'sem_apropriacao' END
FROM program p LEFT JOIN mapping m ON m.center=p.center_key JOIN evidence e ON e.id=p.id;
$$;
REVOKE ALL ON FUNCTION public.weekly_rs_activity_evidence(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.get_weekly_rs_analysis(p_week_id uuid,p_local text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE base jsonb; result jsonb; target_week public.weeks%ROWTYPE; selected_local text:=nullif(upper(btrim(p_local)),'');
BEGIN
  SELECT * INTO target_week FROM public.weeks WHERE id=p_week_id;
  IF NOT FOUND OR NOT coalesce(public.can_access_sap(auth.uid()),false) OR NOT coalesce(public.can_access_worksite(auth.uid(),target_week.worksite_id),false) THEN
    RAISE EXCEPTION 'Sem acesso à análise RS desta obra'; END IF;
  -- Read source metadata only; do not run the legacy full-week calculation before the scoped query.
  SELECT jsonb_build_object(
    'source',(SELECT to_jsonb(i) FROM (
      SELECT s.id,s.source_file_name,s.imported_at,s.imported_by_name,s.row_count FROM public.sap_confirmation_imports s
      WHERE s.week_id=p_week_id AND s.worksite_id=target_week.worksite_id
        AND EXISTS(SELECT 1 FROM public.sap_confirmation_rows r WHERE r.import_id=s.id AND r.worksite_id=s.worksite_id)
      ORDER BY s.imported_at DESC,s.id DESC LIMIT 1) i),
    'availability',(SELECT to_jsonb(a)||jsonb_build_object('updated_by_name',coalesce(p.full_name,'Usuário')) FROM public.weekly_rs_availability a
      LEFT JOIN public.profiles p ON p.id=a.updated_by WHERE a.week_id=p_week_id AND a.worksite_id=target_week.worksite_id),
    'previousAvailability',NULL
  ) INTO base;
  IF selected_local IS NOT NULL AND selected_local NOT IN ('IARI','ROTINA') THEN RAISE EXCEPTION 'Local inválido'; END IF;
  WITH all_program AS MATERIALIZED (SELECT * FROM public.weekly_rs_activity_evidence(p_week_id)),
  program AS MATERIALIZED (SELECT * FROM all_program WHERE selected_local IS NULL OR local=selected_local),
  mapping AS (
    SELECT upper(btrim(r->>'center')) center,min(r->>'specialty') specialty,
      CASE WHEN count(DISTINCT upper(btrim(r->>'local')))=1 THEN min(upper(btrim(r->>'local'))) END local
    FROM jsonb_array_elements(coalesce(base->'availability'->'rows','[]'::jsonb)) r GROUP BY 1
  ), sap AS MATERIALIZED (
    SELECT s.*,regexp_replace(regexp_replace(btrim(coalesce(s.confirmation,'')),'([,.]0+)$','','g'),'^0+','') confirmation_key
    FROM public.sap_confirmation_rows s WHERE s.import_id=(base->'source'->>'id')::uuid AND s.week_id=p_week_id
      AND s.worksite_id=(SELECT worksite_id FROM public.weeks WHERE id=p_week_id) AND s.has_confirmation AND s.actual_work>0
  ), sap_matches AS (
    SELECT s.id,count(p.id) matches,count(DISTINCT p.local) local_count,min(p.local) local FROM sap s
    LEFT JOIN all_program p ON p.confirmation=s.confirmation_key AND p.confirmation<>'' AND p.scheduled_date BETWEEN
      coalesce(s.actual_start_date,s.actual_end_date,p.scheduled_date) AND coalesce(s.actual_end_date,s.actual_start_date,p.scheduled_date)
    GROUP BY s.id
  ), classified AS MATERIALIZED (
    SELECT s.*,upper(btrim(coalesce(s.work_center,''))) center,
      coalesce(CASE WHEN matches.local_count=1 THEN matches.local END,m.local,'SEM LOCAL') local,
      CASE WHEN matches.matches>0 THEN 'programmed'
        WHEN regexp_replace(regexp_replace(btrim(coalesce(s.planning_code,'')),'([,.]0+)$','','g'),'^0+','')='2' THEN 'immediate'
        WHEN regexp_replace(regexp_replace(btrim(coalesce(s.planning_code,'')),'([,.]0+)$','','g'),'^0+','')='1' THEN 'unprogrammed'
        ELSE 'unclassified' END category
    FROM sap s LEFT JOIN mapping m ON m.center=upper(btrim(coalesce(s.work_center,''))) JOIN sap_matches matches ON matches.id=s.id
  ), scoped_sap AS (SELECT * FROM classified WHERE selected_local IS NULL OR local=selected_local),
  planned_centers AS (SELECT center,local,coalesce(sum(planned_hh),0) programmed FROM program GROUP BY center,local),
  realized_centers AS (SELECT center,local,coalesce(sum(actual_work) FILTER(WHERE category='programmed'),0) completed,
    coalesce(sum(actual_work) FILTER(WHERE category='immediate'),0) immediate FROM scoped_sap GROUP BY center,local),
  centers AS (
    SELECT coalesce(p.center,r.center) center,coalesce(p.local,r.local) local,coalesce(p.programmed,0) programmed,
      coalesce(r.completed,0) completed,coalesce(r.immediate,0) immediate
    FROM planned_centers p FULL JOIN realized_centers r ON p.center=r.center AND p.local=r.local
  ), pending AS MATERIALIZED (
    SELECT * FROM program WHERE included_in_rs AND sap_state IN ('sem_apropriacao','sem_confirmacao')
  ), reasons AS (
    SELECT justification,count(*) tasks,coalesce(sum(planned_hh),0) planned_hh FROM pending GROUP BY justification
  )
  SELECT jsonb_build_object(
    'emptyProgrammedRows',(SELECT count(*) FROM public.activities a WHERE a.week_id=p_week_id AND a.worksite_id=target_week.worksite_id AND NOT a.is_immediate)-(SELECT count(*) FROM all_program),
    'local',selected_local,'centers',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY center,local) FROM centers c),'[]'::jsonb),
    'programmed',(SELECT coalesce(sum(planned_hh),0) FROM program),
    'programmedTasks',(SELECT count(*) FROM program),
    'invalidPlannedHours',(SELECT count(*) FROM program WHERE included_in_rs AND planned_hh IS NULL),
    'completed',CASE WHEN base->'source'<>'null'::jsonb THEN (SELECT coalesce(sum(actual_work) FILTER(WHERE category='programmed'),0) FROM scoped_sap) END,
    'immediate',CASE WHEN base->'source'<>'null'::jsonb THEN (SELECT coalesce(sum(actual_work) FILTER(WHERE category='immediate'),0) FROM scoped_sap) END,
    'unprogrammed',(SELECT coalesce(sum(actual_work) FILTER(WHERE category='unprogrammed'),0) FROM scoped_sap),
    'unclassified',(SELECT coalesce(sum(actual_work) FILTER(WHERE category='unclassified'),0) FROM scoped_sap),
    'missingDates',(SELECT count(*) FROM scoped_sap WHERE actual_start_date IS NULL AND actual_end_date IS NULL),
    'outsidePeriod',(SELECT count(*) FROM scoped_sap WHERE actual_start_date<(SELECT start_date FROM public.weeks WHERE id=p_week_id) OR actual_end_date>(SELECT end_date FROM public.weeks WHERE id=p_week_id)
      OR actual_end_date<(SELECT start_date FROM public.weeks WHERE id=p_week_id) OR actual_start_date>(SELECT end_date FROM public.weeks WHERE id=p_week_id)),
    'unresolvedLocal',(SELECT count(*) FROM classified c LEFT JOIN mapping m ON m.center=c.center WHERE c.local='SEM LOCAL' AND c.category IN ('programmed','immediate')
      AND upper(btrim(coalesce(m.specialty,''))) NOT IN ('ALPINISTA','ALPINISTAS','ALPINISMO')),
    'pendingSummary',jsonb_build_object(
      'programmed',(SELECT count(*) FROM program WHERE included_in_rs),
      'confirmed',CASE WHEN base->'source'<>'null'::jsonb THEN (SELECT count(*) FROM program WHERE included_in_rs AND sap_state='apropriada') END,
      'pending',CASE WHEN base->'source'<>'null'::jsonb THEN (SELECT count(*) FROM pending) END,
      'executed',CASE WHEN base->'source'<>'null'::jsonb THEN (SELECT count(*) FROM pending WHERE status='EXECUTADO') END,
      'withJustification',CASE WHEN base->'source'<>'null'::jsonb THEN (SELECT count(*) FROM pending WHERE justification IS NOT NULL) END,
      'withoutJustification',CASE WHEN base->'source'<>'null'::jsonb THEN (SELECT count(*) FROM pending WHERE justification IS NULL) END,
      'plannedHh',CASE WHEN base->'source'<>'null'::jsonb THEN (SELECT coalesce(sum(planned_hh),0) FROM pending) END,
      'unknownPeriod',(SELECT count(*) FROM program WHERE included_in_rs AND sap_state='periodo_indefinido'),
      'monitoringTasks',(SELECT count(*) FROM program WHERE NOT included_in_rs)),
    'reasons',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY tasks DESC,justification NULLS LAST) FROM reasons r),'[]'::jsonb)
  ) INTO result;
  RETURN base||result;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_weekly_rs_pending(p_week_id uuid,p_local text DEFAULT NULL,p_offset integer DEFAULT 0,p_limit integer DEFAULT 50,
  p_justification text DEFAULT NULL,p_only_missing_justification boolean DEFAULT false,p_include_monitoring boolean DEFAULT false,p_query text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE target_week public.weeks%ROWTYPE; result jsonb; selected_local text:=nullif(upper(btrim(p_local)),'');
BEGIN
  SELECT * INTO target_week FROM public.weeks WHERE id=p_week_id;
  IF NOT FOUND OR NOT coalesce(public.can_access_sap(auth.uid()),false) OR NOT coalesce(public.can_access_worksite(auth.uid(),target_week.worksite_id),false) THEN
    RAISE EXCEPTION 'Sem acesso às pendências SAP desta obra'; END IF;
  IF (selected_local IS NOT NULL AND selected_local NOT IN ('IARI','ROTINA')) OR p_offset IS NULL OR p_offset<0 OR p_limit IS NULL
    OR p_limit NOT BETWEEN 1 AND 100 OR length(coalesce(p_query,''))>200 OR length(coalesce(p_justification,''))>200 THEN
    RAISE EXCEPTION 'Filtros ou paginação inválidos'; END IF;
  WITH filtered AS MATERIALIZED (
    SELECT * FROM public.weekly_rs_activity_evidence(p_week_id) e WHERE sap_state IN ('sem_apropriacao','sem_confirmacao')
      AND (selected_local IS NULL OR e.local=selected_local) AND (p_include_monitoring OR e.included_in_rs)
      AND (p_justification IS NULL OR e.justification=p_justification)
      AND (NOT p_only_missing_justification OR e.justification IS NULL)
      AND (coalesce(p_query,'')='' OR concat_ws(' ',e.order_number,e.operation,e.confirmation,e.description) ILIKE '%'||p_query||'%')
  ), page AS (
    SELECT * FROM filtered ORDER BY (status='EXECUTADO') DESC,scheduled_date,order_number,operation,id LIMIT p_limit OFFSET p_offset
  ), details AS (
    SELECT p.*,audit.changed_by_name justification_by,audit.changed_at justification_at
    FROM page p LEFT JOIN LATERAL (
      SELECT h.changed_by_name,h.changed_at FROM public.activity_history h WHERE h.activity_id=p.id AND h.week_id=p_week_id
        AND h.worksite_id=target_week.worksite_id AND p.justification IS NOT NULL AND h.new_values->>'justification'=p.justification
        AND h.previous_values->>'justification' IS DISTINCT FROM h.new_values->>'justification'
      ORDER BY h.changed_at DESC,h.id DESC LIMIT 1
    ) audit ON true
  ) SELECT jsonb_build_object('total',(SELECT count(*) FROM filtered),
    'rows',coalesce((SELECT jsonb_agg(to_jsonb(d) ORDER BY (status='EXECUTADO') DESC,scheduled_date,order_number,operation,id) FROM details d),'[]'::jsonb)
  ) INTO result;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_weekly_rs_analysis(uuid,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.get_weekly_rs_pending(uuid,text,integer,integer,text,boolean,boolean,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_weekly_rs_analysis(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_weekly_rs_pending(uuid,text,integer,integer,text,boolean,boolean,text) TO authenticated;
