-- Cap programmed SAP HH by normalized confirmation within the selected week before specialty limits.
-- A weekly proportional allocation across its SAP rows preserves the total without multiplying by days.
CREATE OR REPLACE FUNCTION public.get_weekly_rs_analysis(p_week_id uuid, p_local text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  ), confirmation_plans AS (
    SELECT confirmation,included_in_rs,coalesce(sum(planned_hh),0) programmed
    FROM all_program WHERE confirmation<>'' GROUP BY confirmation,included_in_rs
  ), confirmation_sap AS (
    SELECT c.confirmation_key,public.weekly_rs_included(c.center,m.specialty) included_in_rs,sum(c.actual_work) actual
    FROM classified c LEFT JOIN mapping m ON m.center=c.center WHERE c.category='programmed' GROUP BY 1,2
  ), credited AS MATERIALIZED (
    SELECT c.*,CASE WHEN c.category='programmed' THEN
      c.actual_work * least(1::numeric,coalesce(p.programmed,0)/nullif(s.actual,0))
      ELSE 0::numeric END completed_for_rs
    FROM classified c LEFT JOIN mapping m ON m.center=c.center
    LEFT JOIN confirmation_plans p ON p.confirmation=c.confirmation_key AND p.included_in_rs=public.weekly_rs_included(c.center,m.specialty)
    LEFT JOIN confirmation_sap s ON s.confirmation_key=c.confirmation_key AND s.included_in_rs=public.weekly_rs_included(c.center,m.specialty)
  ), scoped_sap AS (SELECT * FROM credited WHERE selected_local IS NULL OR local=selected_local),
  planned_centers AS (SELECT center,local,coalesce(sum(planned_hh),0) programmed FROM program GROUP BY center,local),
  realized_centers AS (SELECT center,local,coalesce(sum(actual_work) FILTER(WHERE category='programmed'),0) completed,
    coalesce(sum(completed_for_rs),0) completed_for_rs,
    coalesce(sum(actual_work) FILTER(WHERE category='immediate'),0) immediate FROM scoped_sap GROUP BY center,local),
  centers AS (
    SELECT coalesce(p.center,r.center) center,coalesce(p.local,r.local) local,coalesce(p.programmed,0) programmed,
      coalesce(r.completed,0) completed,coalesce(r.completed_for_rs,0) AS "completedForRs",coalesce(r.immediate,0) immediate
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
      AND public.weekly_rs_included(c.center,m.specialty)),
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
$function$;
NOTIFY pgrst,'reload schema';
