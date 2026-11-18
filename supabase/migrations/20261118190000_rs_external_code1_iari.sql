CREATE OR REPLACE FUNCTION public.rs_external_sap_counts(p_worksite uuid,p_local text,p_code text)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path TO 'public' AS $$
 SELECT public.normalize_sap_identifier(p_code)='2' OR
 (p_worksite='52504243-0000-4000-8000-000000000001'::uuid AND upper(btrim(p_local))='IARI' AND public.normalize_sap_identifier(p_code)='1');
$$;
REVOKE ALL ON FUNCTION public.rs_external_sap_counts(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rs_external_sap_counts(uuid,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_weekly_rs_official_analysis(p_week_id uuid, p_local text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE w public.weeks%ROWTYPE; b public.weekly_rs_program_bases%ROWTYPE; av jsonb; src jsonb; selected_local text:=nullif(upper(btrim(p_local)),''); result jsonb;
BEGIN
 SELECT * INTO w FROM public.weeks WHERE id=p_week_id;
 IF NOT FOUND OR NOT coalesce(public.can_access_sap(auth.uid()),false) OR NOT coalesce(public.can_access_worksite(auth.uid(),w.worksite_id),false) THEN RAISE EXCEPTION 'Sem acesso ao RS desta obra'; END IF;
 IF selected_local IS NOT NULL AND selected_local NOT IN ('IARI','ROTINA') THEN RAISE EXCEPTION 'Local inválido'; END IF;
 SELECT * INTO b FROM public.weekly_rs_program_bases WHERE week_id=w.id AND worksite_id=w.worksite_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Base oficial não encontrada'; END IF;
 SELECT to_jsonb(a)||jsonb_build_object('updated_by_name',coalesce(p.full_name,'Usuário')) INTO av FROM public.weekly_rs_availability a LEFT JOIN public.profiles p ON p.id=a.updated_by WHERE a.week_id=w.id AND a.worksite_id=w.worksite_id;
 SELECT to_jsonb(i) INTO src FROM (SELECT id,source_file_name,imported_at,imported_by_name,row_count FROM public.sap_confirmation_imports i WHERE week_id=w.id AND worksite_id=w.worksite_id AND EXISTS(SELECT 1 FROM public.sap_confirmation_rows r WHERE r.import_id=i.id AND r.worksite_id=w.worksite_id) ORDER BY imported_at DESC,id DESC LIMIT 1) i;
 WITH mapping AS (
  SELECT public.rs_program_center(r->>'center') center,min(r->>'specialty') specialty,CASE WHEN count(DISTINCT upper(btrim(r->>'local')))=1 THEN min(upper(btrim(r->>'local'))) END local FROM jsonb_array_elements(coalesce(av->'rows','[]')) r GROUP BY 1
 ), operational_locations AS (
  SELECT regexp_replace(regexp_replace(btrim(coalesce(a.planning_data->>'Confirmação',a.planning_data->>'Confirmacao','')),'([,.]0+)$','','g'),'^0+','') confirmation,
   CASE WHEN count(DISTINCT upper(btrim(a.planning_data->>'Local'))) FILTER(WHERE upper(btrim(a.planning_data->>'Local')) IN ('IARI','ROTINA'))=1 THEN min(upper(btrim(a.planning_data->>'Local'))) FILTER(WHERE upper(btrim(a.planning_data->>'Local')) IN ('IARI','ROTINA')) END local
  FROM public.activities a WHERE week_id=w.id AND worksite_id=w.worksite_id AND NOT is_immediate GROUP BY 1
 ), all_program AS MATERIALIZED (
  SELECT r->>'confirmation' confirmation,r->>'center' center,(r->>'work')::numeric planned_hh,public.rs_center_local(r->>'center',coalesce(m.local,o.local,'SEM LOCAL')) local,public.weekly_rs_included(r->>'center',m.specialty) included
  FROM jsonb_array_elements(b.rows) r LEFT JOIN mapping m ON m.center=r->>'center' LEFT JOIN operational_locations o ON o.confirmation=r->>'confirmation'
 ), program AS (SELECT * FROM all_program WHERE selected_local IS NULL OR local=selected_local),
 sap AS MATERIALIZED (
  SELECT s.*,regexp_replace(regexp_replace(btrim(coalesce(s.confirmation,'')),'([,.]0+)$','','g'),'^0+','') confirmation_key,public.rs_program_center(s.work_center) center
  FROM public.sap_confirmation_rows s WHERE import_id=(src->>'id')::uuid AND week_id=w.id AND worksite_id=w.worksite_id AND has_confirmation AND actual_work>0
 ), classified AS MATERIALIZED (
  SELECT s.*,public.rs_center_local(s.center,coalesce(p.local,m.local,'SEM LOCAL')) local,public.weekly_rs_included(s.center,m.specialty) included,
   CASE WHEN p.confirmation IS NOT NULL THEN 'programmed' WHEN public.rs_external_sap_counts(w.worksite_id,public.rs_center_local(s.center,coalesce(p.local,m.local,'SEM LOCAL')),s.planning_code) THEN 'immediate' WHEN regexp_replace(coalesce(s.planning_code,''),'([,.]0+)$','','g')='1' THEN 'unprogrammed' ELSE 'unclassified' END category
  FROM sap s LEFT JOIN all_program p ON p.confirmation=s.confirmation_key LEFT JOIN mapping m ON m.center=s.center
 ), confirmation_sap AS (SELECT confirmation_key,included,sum(actual_work) actual FROM classified WHERE category='programmed' GROUP BY 1,2),
 credited AS MATERIALIZED (
  SELECT c.*,CASE WHEN c.category='programmed' THEN c.actual_work*least(1::numeric,coalesce(p.planned_hh,0)/nullif(s.actual,0)) ELSE 0 END credit
  FROM classified c LEFT JOIN all_program p ON p.confirmation=c.confirmation_key AND p.included=c.included LEFT JOIN confirmation_sap s ON s.confirmation_key=c.confirmation_key AND s.included=c.included
 ), scoped_sap AS (SELECT * FROM credited WHERE selected_local IS NULL OR local=selected_local),
 pc AS (SELECT center,local,sum(planned_hh) programmed FROM program GROUP BY 1,2),
 rc AS (SELECT center,local,coalesce(sum(actual_work) FILTER(WHERE category='programmed'),0) completed,sum(credit) credited,coalesce(sum(actual_work) FILTER(WHERE category='immediate'),0) immediate FROM scoped_sap GROUP BY 1,2),
 centers AS (SELECT coalesce(pc.center,rc.center) center,coalesce(pc.local,rc.local) local,coalesce(pc.programmed,0) programmed,coalesce(rc.completed,0) completed,coalesce(rc.credited,0) AS "completedForRs",coalesce(rc.immediate,0) immediate FROM pc FULL JOIN rc ON pc.center=rc.center AND pc.local=rc.local)
 SELECT jsonb_build_object(
  'programBasis',(to_jsonb(b)-'rows')||jsonb_build_object('kind','official','datePolicy','whole-selected-week'),
  'availability',av,'source',src,'previousAvailability',NULL,'local',selected_local,
  'centers',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY center,local) FROM centers c),'[]'),
  'programmed',(SELECT coalesce(sum(planned_hh),0) FROM program),'programmedTasks',(SELECT count(*) FROM program),'emptyProgrammedRows',0,'invalidPlannedHours',0,
  'completed',CASE WHEN src IS NOT NULL THEN (SELECT coalesce(sum(actual_work) FILTER(WHERE category='programmed'),0) FROM scoped_sap) END,
  'immediate',CASE WHEN src IS NOT NULL THEN (SELECT coalesce(sum(actual_work) FILTER(WHERE category='immediate'),0) FROM scoped_sap) END,
  'unprogrammed',(SELECT coalesce(sum(actual_work) FILTER(WHERE category='unprogrammed'),0) FROM scoped_sap),'unclassified',(SELECT coalesce(sum(actual_work) FILTER(WHERE category='unclassified'),0) FROM scoped_sap),
  'missingDates',(SELECT count(*) FROM scoped_sap WHERE actual_start_date IS NULL AND actual_end_date IS NULL),
  'outsidePeriod',(SELECT count(*) FROM scoped_sap WHERE actual_start_date<w.start_date OR actual_end_date>w.end_date OR actual_end_date<w.start_date OR actual_start_date>w.end_date),
  'unresolvedLocal',(SELECT count(*) FROM all_program WHERE included AND local='SEM LOCAL')+(SELECT count(*) FROM classified WHERE included AND local='SEM LOCAL' AND category IN ('programmed','immediate')),
  'pendingSummary',jsonb_build_object('programmed',(SELECT count(*) FROM program WHERE included),'confirmed',(SELECT count(*) FROM program p WHERE included AND EXISTS(SELECT 1 FROM sap s WHERE s.confirmation_key=p.confirmation)),
   'pending',(SELECT count(*) FROM program p WHERE included AND NOT EXISTS(SELECT 1 FROM sap s WHERE s.confirmation_key=p.confirmation)),'executed',0,'withJustification',0,'withoutJustification',0,'plannedHh',0,'unknownPeriod',0,'monitoringTasks',(SELECT count(*) FROM program WHERE NOT included)),'reasons','[]'::jsonb
 ) INTO result;
 RETURN result;
END $function$
;
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
  IF EXISTS(SELECT 1 FROM public.weekly_rs_program_bases WHERE week_id=p_week_id AND worksite_id=target_week.worksite_id) THEN
    RETURN public.get_weekly_rs_official_analysis(p_week_id,p_local);
  END IF;
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
      public.rs_center_local(s.work_center,coalesce(CASE WHEN matches.local_count=1 THEN matches.local END,m.local,'SEM LOCAL')) local,
      CASE WHEN matches.matches>0 THEN 'programmed'
        WHEN public.rs_external_sap_counts(target_week.worksite_id,public.rs_center_local(s.work_center,coalesce(CASE WHEN matches.local_count=1 THEN matches.local END,m.local,'SEM LOCAL')),s.planning_code) THEN 'immediate'
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
  RETURN base||result||jsonb_build_object('programBasis',jsonb_build_object('kind','operational'));
END;
$function$
;
CREATE OR REPLACE FUNCTION public.capture_weekly_rs_closure(p_week_id uuid, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE w public.weeks%ROWTYPE; actor text; cid uuid; v int; d jsonb; calc jsonb; scopes jsonb:='{}'; scope text;
BEGIN
  PERFORM public.assert_sap_closure_admin(p_week_id);
  SELECT * INTO w FROM public.weeks WHERE id=p_week_id FOR UPDATE;
  IF nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Informe a justificativa do fechamento'; END IF;
  IF w.sap_closure_status='closed' THEN
    SELECT id INTO cid FROM public.weekly_rs_closures WHERE week_id=p_week_id ORDER BY version DESC LIMIT 1;
    IF cid IS NOT NULL THEN RETURN cid; END IF;
  END IF;
  -- Keep source state stable while copying. SAP loads and availability writes share the week lock.
  PERFORM id FROM public.activities WHERE week_id=p_week_id AND worksite_id=w.worksite_id ORDER BY id FOR SHARE;
  FOREACH scope IN ARRAY ARRAY['ALL','IARI','ROTINA'] LOOP
    d:=public.get_weekly_rs_analysis(p_week_id,CASE WHEN scope='ALL' THEN NULL ELSE scope END);
    calc:=public.rs_archive_calculation(d,CASE WHEN scope='ALL' THEN NULL ELSE scope END);
    IF scope='ALL' AND calc->'result'='null'::jsonb THEN
      RAISE EXCEPTION 'Não é possível fechar o RS: confira a carga SAP detalhada, a disponibilidade, os vínculos e os HH válidos. Pendências de execução não impedem o fechamento.';
    END IF;
    scopes:=scopes||jsonb_build_object(scope,d||jsonb_build_object('frozenCalculation',calc));
  END LOOP;
  SELECT coalesce(full_name,'Administrador') INTO actor FROM public.profiles WHERE id=auth.uid();
  SELECT coalesce(max(version),0)+1 INTO v FROM public.weekly_rs_closures WHERE week_id=p_week_id;
  INSERT INTO public.weekly_rs_closures(week_id,worksite_id,version,closed_by,closed_by_name,reason,rule_version,rules,week_info,summary)
  VALUES(w.id,w.worksite_id,v,auth.uid(),actor,left(btrim(p_reason),500),'rs-hh-2026-11-18-v5',
    jsonb_build_object('externalCode1Iari',w.worksite_id='52504243-0000-4000-8000-000000000001'::uuid,'centerLocalRule','SERVIARI sempre IARI; demais vínculos preservados','source','Última carga SAP detalhada da semana','programmedBasis','Programação SAP quando informada; fallback operacional','programmedDates','HH integral na semana selecionada; sem rateio por datas','programmedCredit','min(SAP,programado) por confirmação',
      'cap','semanal por especialidade','occupationCap',1,'availabilityIncludesEep',true,'factors','<95:-0.02;95<=RS<98:-0.01;98<=RS<=100:0;>100:+0.01',
      'excludedCenters',jsonb_build_array('INSPPINT','TECNIEND','TECNINSC','HIDROJAT','HIDROJATO'),'excludedSpecialties',jsonb_build_array('ALPINISTA','ALPINISTAS','ALPINISMO')),
    to_jsonb(w),jsonb_build_object('ALL',scopes->'ALL'->'frozenCalculation'->'result','IARI',scopes->'IARI'->'frozenCalculation'->'result','ROTINA',scopes->'ROTINA'->'frozenCalculation'->'result')) RETURNING id INTO cid;
  INSERT INTO public.weekly_rs_closure_scopes SELECT cid,key,value FROM jsonb_each(scopes);
  INSERT INTO public.weekly_rs_closure_items(closure_id,kind,source_id,local,record_date,payload,evidence)
    SELECT cid,'activity',a.id::text,e.local,a.scheduled_date,to_jsonb(a),CASE WHEN e.id IS NOT NULL THEN to_jsonb(e)||jsonb_build_object('justification_by',h.changed_by_name,'justification_at',h.changed_at) END
    FROM public.activities a LEFT JOIN public.weekly_rs_activity_evidence(p_week_id) e ON e.id=a.id
    LEFT JOIN LATERAL (SELECT changed_by_name,changed_at FROM public.activity_history ah WHERE ah.activity_id=a.id AND ah.week_id=p_week_id AND ah.worksite_id=w.worksite_id
      AND a.justification IS NOT NULL AND ah.new_values->>'justification'=a.justification AND ah.previous_values->>'justification' IS DISTINCT FROM ah.new_values->>'justification' ORDER BY changed_at DESC,id DESC LIMIT 1) h ON true
    WHERE a.week_id=p_week_id AND a.worksite_id=w.worksite_id;
  INSERT INTO public.weekly_rs_closure_items(closure_id,kind,source_id,payload)
    SELECT cid,'activity_history',h.id::text,to_jsonb(h) FROM public.activity_history h WHERE h.week_id=p_week_id AND h.worksite_id=w.worksite_id;
  INSERT INTO public.weekly_rs_closure_items(closure_id,kind,source_id,payload)
    SELECT cid,'sap',r.id::text,to_jsonb(r) FROM public.sap_confirmation_rows r WHERE r.import_id=(scopes->'ALL'->'source'->>'id')::uuid AND r.worksite_id=w.worksite_id;
  INSERT INTO public.weekly_rs_closure_items(closure_id,kind,source_id,payload)
    SELECT cid,'sap_import',i.id::text,to_jsonb(i) FROM public.sap_confirmation_imports i WHERE i.id=(scopes->'ALL'->'source'->>'id')::uuid AND i.worksite_id=w.worksite_id;
  INSERT INTO public.weekly_rs_closure_items(closure_id,kind,source_id,payload)
    SELECT cid,'availability',a.week_id::text,to_jsonb(a) FROM public.weekly_rs_availability a WHERE a.week_id=p_week_id AND a.worksite_id=w.worksite_id;
  INSERT INTO public.weekly_rs_closure_items(closure_id,kind,source_id,payload)
    SELECT cid,'availability_history',a.version::text,to_jsonb(a) FROM public.weekly_rs_availability_history a WHERE a.week_id=p_week_id AND a.worksite_id=w.worksite_id;
  INSERT INTO public.weekly_rs_closure_items(closure_id,kind,source_id,payload)
    SELECT cid,'program_basis',b.week_id::text,to_jsonb(b) FROM public.weekly_rs_program_bases b WHERE b.week_id=p_week_id AND b.worksite_id=w.worksite_id;
  INSERT INTO public.weekly_rs_closure_items(closure_id,kind,source_id,payload)
    SELECT cid,'program_basis_history',b.version::text,to_jsonb(b) FROM public.weekly_rs_program_base_history b WHERE b.week_id=p_week_id AND b.worksite_id=w.worksite_id;
  RETURN cid;
END $function$
;
CREATE OR REPLACE FUNCTION public.get_rs_center_immediate_tasks(p_sources jsonb, p_center text, p_local text DEFAULT NULL::text, p_offset integer DEFAULT 0, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE requested jsonb; chosen jsonb:='[]'; w public.weeks%ROWTYPE; closure_record public.weekly_rs_closures%ROWTYPE;
 cid uuid; sid uuid; official boolean; scope_local text:=nullif(upper(btrim(p_local)),''); result jsonb;
BEGIN
 IF NOT coalesce(public.can_access_sap(auth.uid()),false) THEN RAISE EXCEPTION 'Sem acesso às pendências do RS'; END IF;
 IF jsonb_typeof(p_sources) IS DISTINCT FROM 'array' OR jsonb_array_length(p_sources) NOT BETWEEN 1 AND 12
 OR p_center IS NULL OR btrim(p_center)='' OR length(p_center)>160
 OR (scope_local IS NOT NULL AND scope_local NOT IN ('IARI','ROTINA'))
 OR p_offset IS NULL OR p_offset<0 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Filtros inválidos'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_sources) s GROUP BY s->>'week_id' HAVING count(*)>1) THEN RAISE EXCEPTION 'Semana duplicada'; END IF;
 FOR requested IN SELECT * FROM jsonb_array_elements(p_sources) LOOP
  SELECT * INTO w FROM public.weeks WHERE id=(requested->>'week_id')::uuid;
  IF NOT FOUND OR NOT coalesce(public.can_access_worksite(auth.uid(),w.worksite_id),false) THEN RAISE EXCEPTION 'Sem acesso à semana solicitada'; END IF;
  cid:=nullif(requested->>'closure_id','')::uuid;
  IF cid IS NULL AND w.sap_closure_status='closed' THEN
   SELECT id INTO cid FROM public.weekly_rs_closures WHERE week_id=w.id AND worksite_id=w.worksite_id ORDER BY version DESC LIMIT 1;
   IF cid IS NULL THEN RAISE EXCEPTION 'Semana fechada sem memória preservada para este detalhamento'; END IF;
  END IF;
  IF cid IS NOT NULL THEN
   SELECT * INTO closure_record FROM public.weekly_rs_closures WHERE id=cid AND week_id=w.id AND worksite_id=w.worksite_id;
   IF NOT FOUND THEN RAISE EXCEPTION 'Fechamento não corresponde à semana solicitada'; END IF;
   SELECT nullif(payload->>'id','')::uuid INTO sid FROM public.weekly_rs_closure_items WHERE closure_id=cid AND kind='sap_import' LIMIT 1;
   official:=EXISTS(SELECT 1 FROM public.weekly_rs_closure_items WHERE closure_id=cid AND kind='program_basis')
    OR EXISTS(SELECT 1 FROM public.weekly_rs_closure_scopes WHERE closure_id=cid AND data->'programBasis'->>'kind'='official');
  ELSE
   SELECT i.id INTO sid FROM public.sap_confirmation_imports i WHERE week_id=w.id AND worksite_id=w.worksite_id
    AND EXISTS(SELECT 1 FROM public.sap_confirmation_rows r WHERE r.import_id=i.id AND r.worksite_id=w.worksite_id)
    ORDER BY imported_at DESC,id DESC LIMIT 1;
   official:=EXISTS(SELECT 1 FROM public.weekly_rs_program_bases WHERE week_id=w.id AND worksite_id=w.worksite_id);
  END IF;
  chosen:=chosen||jsonb_build_array(jsonb_build_object('week_id',w.id,'week_code',w.code,'closure_id',cid,'source_id',sid,'official',official,'code1_iari',w.worksite_id='52504243-0000-4000-8000-000000000001'::uuid AND (cid IS NULL OR coalesce((closure_record.rules->>'externalCode1Iari')::boolean,false))));
 END LOOP;
 WITH sources AS MATERIALIZED (
 SELECT * FROM jsonb_to_recordset(chosen) s(week_id uuid,week_code text,closure_id uuid,source_id uuid,official boolean,code1_iari boolean)
 ), sap AS MATERIALIZED (
 SELECT s.*,to_jsonb(r) payload FROM sources s JOIN public.sap_confirmation_rows r ON s.closure_id IS NULL AND r.import_id=s.source_id AND r.week_id=s.week_id
 UNION ALL
 SELECT s.*,i.payload FROM sources s JOIN public.weekly_rs_closure_items i ON i.closure_id=s.closure_id AND i.kind='sap'
 ), available AS MATERIALIZED (
 SELECT s.week_id,r FROM sources s JOIN public.weekly_rs_availability a ON a.week_id=s.week_id AND s.closure_id IS NULL CROSS JOIN LATERAL jsonb_array_elements(a.rows) r
 UNION ALL
 SELECT s.week_id,r FROM sources s JOIN public.weekly_rs_closure_scopes c ON c.closure_id=s.closure_id AND c.scope='ALL' CROSS JOIN LATERAL jsonb_array_elements(coalesce(c.data->'availability'->'rows','[]')) r
 ), program AS MATERIALIZED (
 SELECT s.week_id,public.normalize_sap_identifier(r->>'confirmation') confirmation FROM sources s JOIN public.weekly_rs_program_bases b ON b.week_id=s.week_id AND s.closure_id IS NULL CROSS JOIN LATERAL jsonb_array_elements(b.rows) r
 UNION
 SELECT s.week_id,public.normalize_sap_identifier(r->>'confirmation') FROM sources s JOIN public.weekly_rs_closure_items i ON i.closure_id=s.closure_id AND i.kind='program_basis' CROSS JOIN LATERAL jsonb_array_elements(coalesce(i.payload->'rows','[]')) r
 ), operational AS MATERIALIZED (
 SELECT s.week_id,to_jsonb(e) payload FROM sources s CROSS JOIN LATERAL public.weekly_rs_activity_evidence(s.week_id) e WHERE s.closure_id IS NULL AND NOT s.official
 UNION ALL
 SELECT s.week_id,i.evidence FROM sources s JOIN public.weekly_rs_closure_items i ON i.closure_id=s.closure_id AND i.kind='activity' WHERE NOT s.official
 ), classified AS MATERIALIZED (
 SELECT s.*,public.rs_program_center(s.payload->>'work_center') center,
 public.rs_center_local(s.payload->>'work_center',coalesce(m.local,'SEM LOCAL')) local
 FROM sap s LEFT JOIN LATERAL (SELECT CASE WHEN count(DISTINCT upper(btrim(r->>'local')))=1 THEN min(upper(btrim(r->>'local'))) END local FROM available a WHERE a.week_id=s.week_id AND public.rs_program_center(a.r->>'center')=public.rs_program_center(s.payload->>'work_center')) m ON true
 WHERE (s.payload->>'has_confirmation')::boolean AND (s.payload->>'actual_work')::numeric>0
 AND (public.normalize_sap_identifier(s.payload->>'planning_code')='2' OR (s.code1_iari AND public.normalize_sap_identifier(s.payload->>'planning_code')='1' AND public.rs_center_local(s.payload->>'work_center',coalesce(m.local,'SEM LOCAL'))='IARI'))
 AND CASE WHEN s.official THEN NOT EXISTS(SELECT 1 FROM program p WHERE p.week_id=s.week_id AND p.confirmation=public.normalize_sap_identifier(s.payload->>'confirmation'))
 ELSE NOT EXISTS(SELECT 1 FROM operational o WHERE o.week_id=s.week_id AND public.normalize_sap_identifier(o.payload->>'confirmation')=public.normalize_sap_identifier(s.payload->>'confirmation')
 AND (o.payload->>'scheduled_date')::date BETWEEN coalesce((s.payload->>'actual_start_date')::date,(s.payload->>'actual_end_date')::date,(o.payload->>'scheduled_date')::date) AND coalesce((s.payload->>'actual_end_date')::date,(s.payload->>'actual_start_date')::date,(o.payload->>'scheduled_date')::date)) END
 ), filtered AS MATERIALIZED (SELECT * FROM classified WHERE center=public.rs_program_center(p_center) AND (scope_local IS NULL OR local=scope_local)),
 page AS (SELECT payload||jsonb_build_object('week_code',week_code,'week_id',week_id,'local',local) row FROM filtered ORDER BY week_code,payload->>'order_number',payload->>'operation',payload->>'id' LIMIT p_limit OFFSET p_offset)
 SELECT jsonb_build_object('total',(SELECT count(*) FROM filtered),'totalHh',(SELECT coalesce(sum((payload->>'actual_work')::numeric),0) FROM filtered),
 'rows',coalesce((SELECT jsonb_agg(row) FROM page),'[]'),'missingSapWeeks',coalesce((SELECT jsonb_agg(week_code) FROM sources WHERE source_id IS NULL),'[]')) INTO result;
 RETURN result;
END $function$
;
