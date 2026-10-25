-- Official weekly programming is independent from operational task dates/status/PTs.
CREATE OR REPLACE FUNCTION public.rs_program_center(p_center text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path=public AS $$
 SELECT CASE WHEN public.rs_archive_key(p_center)='FUNILEIR0293' THEN 'FUNILEIR' ELSE public.rs_archive_key(p_center) END;
$$;
CREATE TABLE public.weekly_rs_program_bases (
 week_id uuid PRIMARY KEY REFERENCES public.weeks(id) ON DELETE RESTRICT,
 worksite_id uuid NOT NULL REFERENCES public.worksites(id), rows jsonb NOT NULL CHECK(jsonb_typeof(rows)='array'),
 version integer NOT NULL CHECK(version>0), source_file_name text NOT NULL, sheet_name text NOT NULL,
 row_count integer NOT NULL, total_work numeric NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
 updated_by uuid NOT NULL REFERENCES auth.users(id), updated_by_name text NOT NULL
);
CREATE TABLE public.weekly_rs_program_base_history (LIKE public.weekly_rs_program_bases INCLUDING DEFAULTS INCLUDING CONSTRAINTS);
ALTER TABLE public.weekly_rs_program_base_history ADD PRIMARY KEY(week_id,version);
ALTER TABLE public.weekly_rs_program_base_history ADD FOREIGN KEY(week_id) REFERENCES public.weeks(id) ON DELETE RESTRICT;
CREATE INDEX rs_program_history_worksite ON public.weekly_rs_program_base_history(worksite_id,week_id,version DESC);
ALTER TABLE public.weekly_rs_program_bases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weekly_rs_program_base_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.weekly_rs_program_bases,public.weekly_rs_program_base_history FROM anon,authenticated;
GRANT SELECT ON public.weekly_rs_program_bases,public.weekly_rs_program_base_history TO authenticated;
CREATE POLICY rs_program_read ON public.weekly_rs_program_bases FOR SELECT TO authenticated USING(public.can_access_sap(auth.uid()) AND public.can_access_worksite(auth.uid(),worksite_id));
CREATE POLICY rs_program_history_read ON public.weekly_rs_program_base_history FOR SELECT TO authenticated USING(public.can_access_sap(auth.uid()) AND public.can_access_worksite(auth.uid(),worksite_id));
CREATE TRIGGER rs_program_lock BEFORE INSERT OR UPDATE ON public.weekly_rs_program_bases FOR EACH ROW EXECUTE FUNCTION public.guard_rs_week_source_write();
CREATE TRIGGER rs_program_history_immutable BEFORE UPDATE OR DELETE ON public.weekly_rs_program_base_history FOR EACH ROW EXECUTE FUNCTION public.rs_archive_immutable();

CREATE FUNCTION public.save_weekly_rs_program_base(p_week_id uuid,p_rows jsonb,p_source_file_name text,p_sheet_name text DEFAULT 'Programação SAP',p_expected_version integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE w public.weeks%ROWTYPE; old public.weekly_rs_program_bases%ROWTYPE; saved public.weekly_rs_program_bases%ROWTYPE; normalized jsonb; actor text;
BEGIN
 SELECT * INTO w FROM public.weeks WHERE id=p_week_id FOR UPDATE;
 IF NOT FOUND OR NOT coalesce(public.can_access_sap(auth.uid()),false) OR NOT coalesce(public.can_access_worksite(auth.uid(),w.worksite_id),false) THEN RAISE EXCEPTION 'Sem acesso à base de programação desta obra'; END IF;
 IF w.sap_closure_status='closed' THEN RAISE EXCEPTION 'Semana fechada. O administrador deve reabrir antes de substituir a base oficial.'; END IF;
 IF p_rows IS NULL OR jsonb_typeof(p_rows)<>'array' THEN RAISE EXCEPTION 'Informe a base oficial'; END IF;
 IF jsonb_array_length(p_rows) NOT BETWEEN 1 AND 5000 OR pg_column_size(p_rows)>10000000 OR p_expected_version IS NULL OR p_expected_version<0
   OR length(btrim(coalesce(p_source_file_name,''))) NOT BETWEEN 1 AND 240 OR length(btrim(coalesce(p_sheet_name,''))) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'Base, arquivo ou versão inválida'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) r WHERE jsonb_typeof(r)<>'object'
   OR coalesce(r->>'confirmation','') !~ '^[0-9]{1,32}$' OR coalesce(r->>'order_number','') !~ '^[0-9]{1,32}$' OR coalesce(r->>'operation','') !~ '^[0-9]{1,32}$'
   OR length(btrim(coalesce(r->>'center',''))) NOT BETWEEN 1 AND 160 OR length(coalesce(r->>'suboperation',''))>32
   OR jsonb_typeof(r->'work') IS DISTINCT FROM 'number' OR NOT ((r->>'work')::numeric>=0 AND (r->>'work')::numeric<1000000000)
   OR jsonb_typeof(r->'source_data') IS DISTINCT FROM 'object' OR coalesce(r->>'source_row_number','') !~ '^[0-9]{1,6}$') THEN RAISE EXCEPTION 'Linha inválida: confira confirmação, ordem, operação, centro e Trabalho'; END IF;
 SELECT jsonb_agg(r||jsonb_build_object('confirmation',regexp_replace(r->>'confirmation','^0+(?=[0-9])','','g'),'center',public.rs_program_center(r->>'center')) ORDER BY (r->>'source_row_number')::int) INTO normalized FROM jsonb_array_elements(p_rows) r;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(normalized) r GROUP BY r->>'confirmation' HAVING count(*)>1) THEN RAISE EXCEPTION 'Confirmação duplicada na base oficial. Use uma linha com o HH completo por confirmação.'; END IF;
 SELECT * INTO old FROM public.weekly_rs_program_bases WHERE week_id=p_week_id;
 IF coalesce(old.version,0)<>p_expected_version THEN RAISE EXCEPTION 'A base oficial foi alterada por outra pessoa. Atualize antes de importar.' USING ERRCODE='40001'; END IF;
 SELECT coalesce(full_name,'Usuário') INTO actor FROM public.profiles WHERE id=auth.uid();
 INSERT INTO public.weekly_rs_program_bases(week_id,worksite_id,rows,version,source_file_name,sheet_name,row_count,total_work,updated_by,updated_by_name)
 VALUES(w.id,w.worksite_id,normalized,p_expected_version+1,btrim(p_source_file_name),btrim(p_sheet_name),jsonb_array_length(normalized),(SELECT sum((r->>'work')::numeric) FROM jsonb_array_elements(normalized) r),auth.uid(),coalesce(actor,'Usuário'))
 ON CONFLICT(week_id) DO UPDATE SET rows=EXCLUDED.rows,version=EXCLUDED.version,source_file_name=EXCLUDED.source_file_name,sheet_name=EXCLUDED.sheet_name,row_count=EXCLUDED.row_count,total_work=EXCLUDED.total_work,updated_at=now(),updated_by=EXCLUDED.updated_by,updated_by_name=EXCLUDED.updated_by_name RETURNING * INTO saved;
 INSERT INTO public.weekly_rs_program_base_history SELECT saved.*;
 RETURN to_jsonb(saved)-'rows';
END $$;
REVOKE ALL ON FUNCTION public.save_weekly_rs_program_base(uuid,jsonb,text,text,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_weekly_rs_program_base(uuid,jsonb,text,text,integer) TO authenticated;

CREATE FUNCTION public.get_weekly_rs_official_analysis(p_week_id uuid,p_local text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
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
  SELECT r->>'confirmation' confirmation,r->>'center' center,(r->>'work')::numeric planned_hh,coalesce(m.local,o.local,'SEM LOCAL') local,public.weekly_rs_included(r->>'center',m.specialty) included
  FROM jsonb_array_elements(b.rows) r LEFT JOIN mapping m ON m.center=r->>'center' LEFT JOIN operational_locations o ON o.confirmation=r->>'confirmation'
 ), program AS (SELECT * FROM all_program WHERE selected_local IS NULL OR local=selected_local),
 sap AS MATERIALIZED (
  SELECT s.*,regexp_replace(regexp_replace(btrim(coalesce(s.confirmation,'')),'([,.]0+)$','','g'),'^0+','') confirmation_key,public.rs_program_center(s.work_center) center
  FROM public.sap_confirmation_rows s WHERE import_id=(src->>'id')::uuid AND week_id=w.id AND worksite_id=w.worksite_id AND has_confirmation AND actual_work>0
 ), classified AS MATERIALIZED (
  SELECT s.*,coalesce(p.local,m.local,'SEM LOCAL') local,public.weekly_rs_included(s.center,m.specialty) included,
   CASE WHEN p.confirmation IS NOT NULL THEN 'programmed' WHEN regexp_replace(coalesce(s.planning_code,''),'([,.]0+)$','','g')='2' THEN 'immediate' WHEN regexp_replace(coalesce(s.planning_code,''),'([,.]0+)$','','g')='1' THEN 'unprogrammed' ELSE 'unclassified' END category
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
END $$;
REVOKE ALL ON FUNCTION public.get_weekly_rs_official_analysis(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_weekly_rs_official_analysis(uuid,text) TO authenticated;

-- Route only RS reports through the new source. Activity progress/status/SAP daily matching is untouched.
DO $migration$
DECLARE definition text;
BEGIN
 SELECT pg_get_functiondef('public.get_weekly_rs_analysis(uuid,text)'::regprocedure) INTO definition;
 IF position('public.get_weekly_rs_official_analysis' IN definition)=0 THEN
  IF position('  -- Read source metadata only;' IN definition)=0 THEN RAISE EXCEPTION 'Análise RS mudou; revisar integração da base oficial'; END IF;
  definition:=replace(definition,'  -- Read source metadata only;',$route$  IF EXISTS(SELECT 1 FROM public.weekly_rs_program_bases WHERE week_id=p_week_id AND worksite_id=target_week.worksite_id) THEN
    RETURN public.get_weekly_rs_official_analysis(p_week_id,p_local);
  END IF;
  -- Read source metadata only;$route$);
  definition:=replace(definition,'RETURN base||result;',$fallback$RETURN base||result||jsonb_build_object('programBasis',jsonb_build_object('kind','operational'));$fallback$);
  EXECUTE definition;
 END IF;
END $migration$;

ALTER TABLE public.weekly_rs_closure_items DROP CONSTRAINT weekly_rs_closure_items_kind_check;
ALTER TABLE public.weekly_rs_closure_items ADD CONSTRAINT weekly_rs_closure_items_kind_check CHECK(kind IN ('activity','activity_history','sap','sap_import','availability','availability_history','program_basis','program_basis_history'));
DO $migration$
DECLARE definition text;
BEGIN
 SELECT pg_get_functiondef('public.capture_weekly_rs_closure(uuid,text)'::regprocedure) INTO definition;
 IF position($capture$'program_basis'$capture$ IN definition)=0 THEN
  IF position('RETURN cid;' IN definition)=0 OR position('rs-hh-2026-10-24-v2' IN definition)=0 THEN RAISE EXCEPTION 'Fechamento RS mudou; revisar preservação da base oficial'; END IF;
  definition:=replace(definition,'  RETURN cid;',$capture$  INSERT INTO public.weekly_rs_closure_items(closure_id,kind,source_id,payload)
    SELECT cid,'program_basis',b.week_id::text,to_jsonb(b) FROM public.weekly_rs_program_bases b WHERE b.week_id=p_week_id AND b.worksite_id=w.worksite_id;
  INSERT INTO public.weekly_rs_closure_items(closure_id,kind,source_id,payload)
    SELECT cid,'program_basis_history',b.version::text,to_jsonb(b) FROM public.weekly_rs_program_base_history b WHERE b.week_id=p_week_id AND b.worksite_id=w.worksite_id;
  RETURN cid;$capture$);
  definition:=replace(definition,'rs-hh-2026-10-24-v2','rs-hh-2026-10-24-v3');
  definition:=replace(definition,$old$'programmedCredit','min(SAP,programado) por confirmação'$old$,$new$'programmedBasis','Programação SAP quando informada; fallback operacional','programmedDates','HH integral na semana selecionada; sem rateio por datas','programmedCredit','min(SAP,programado) por confirmação'$new$);
  EXECUTE definition;
 END IF;
 SELECT pg_get_functiondef('public.get_weekly_rs_closure_items(uuid,text,integer,integer)'::regprocedure) INTO definition;
 IF position($old$'program_basis'$old$ IN definition)=0 THEN
  IF position($old$'availability_history')$old$ IN definition)=0 THEN RAISE EXCEPTION 'Exportação RS mudou; revisar tipos de base oficial'; END IF;
  EXECUTE replace(definition,$old$'availability_history')$old$,$new$'availability_history','program_basis','program_basis_history')$new$);
 END IF;
END $migration$;
NOTIFY pgrst,'reload schema';
