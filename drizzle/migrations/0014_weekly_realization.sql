-- Weekly RS: availability already includes all mobilized EEP.
-- One weekly specialty cap, across all dates/locations; no changes to activities/SAP.
CREATE TABLE IF NOT EXISTS public.weekly_rs_availability (
  week_id uuid PRIMARY KEY REFERENCES public.weeks(id) ON DELETE CASCADE,
  worksite_id uuid NOT NULL REFERENCES public.worksites(id),
  rows jsonb NOT NULL CHECK (jsonb_typeof(rows)='array' AND jsonb_array_length(rows) BETWEEN 1 AND 5000),
  source_file_name text,
  version integer NOT NULL DEFAULT 1,
  updated_by uuid NOT NULL REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.weekly_rs_availability_history (
  week_id uuid NOT NULL REFERENCES public.weeks(id) ON DELETE CASCADE,
  worksite_id uuid NOT NULL REFERENCES public.worksites(id),
  version integer NOT NULL,
  rows jsonb NOT NULL,
  source_file_name text,
  updated_by uuid NOT NULL REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(week_id,version)
);
ALTER TABLE public.weekly_rs_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weekly_rs_availability_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rs availability worksite read" ON public.weekly_rs_availability;
CREATE POLICY "rs availability worksite read" ON public.weekly_rs_availability FOR SELECT TO authenticated
USING ((SELECT public.can_access_sap(auth.uid())) AND public.can_access_worksite(auth.uid(),worksite_id));
DROP POLICY IF EXISTS "rs availability history worksite read" ON public.weekly_rs_availability_history;
CREATE POLICY "rs availability history worksite read" ON public.weekly_rs_availability_history FOR SELECT TO authenticated
USING ((SELECT public.can_access_sap(auth.uid())) AND public.can_access_worksite(auth.uid(),worksite_id));
REVOKE ALL ON public.weekly_rs_availability,public.weekly_rs_availability_history FROM anon,authenticated;
GRANT SELECT ON public.weekly_rs_availability,public.weekly_rs_availability_history TO authenticated;
GRANT ALL ON public.weekly_rs_availability,public.weekly_rs_availability_history TO service_role;

CREATE OR REPLACE FUNCTION public.save_weekly_rs_availability(p_week_id uuid,p_rows jsonb,p_expected_version integer DEFAULT 0,p_source_file_name text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE target_week public.weeks%ROWTYPE; item jsonb; dt date; code text; normalized_rows jsonb; saved public.weekly_rs_availability%ROWTYPE;
BEGIN
  SELECT * INTO target_week FROM public.weeks WHERE id=p_week_id;
  IF NOT FOUND OR NOT coalesce(public.can_access_sap(auth.uid()),false)
    OR NOT coalesce(public.can_access_worksite(auth.uid(),target_week.worksite_id),false) THEN
    RAISE EXCEPTION 'Sem acesso à disponibilidade desta semana';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows)<>'array' THEN RAISE EXCEPTION 'Informe uma tabela de disponibilidade'; END IF;
  IF jsonb_array_length(p_rows) NOT BETWEEN 1 AND 5000 OR p_expected_version IS NULL OR p_expected_version<0
    OR length(coalesce(p_source_file_name,''))>240 THEN RAISE EXCEPTION 'Tabela ou versão inválida'; END IF;
  code:=substring(target_week.code from '^([0-9]{1,3}[-/][0-9]{4})');
  IF code IS NULL THEN code:=target_week.code; ELSE code:=lpad(split_part(replace(code,'/','-'),'-',1),3,'0')||'-'||split_part(replace(code,'/','-'),'-',2); END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    IF jsonb_typeof(item)<>'object' OR jsonb_typeof(item->'hours') IS DISTINCT FROM 'number' OR
      NOT ((item->>'hours')::numeric>=0 AND (item->>'hours')::numeric<1000000000)
      OR jsonb_typeof(item->'center') IS DISTINCT FROM 'string'
      OR jsonb_typeof(item->'local') IS DISTINCT FROM 'string'
      OR jsonb_typeof(item->'specialty') IS DISTINCT FROM 'string'
      OR length(btrim(coalesce(item->>'center',''))) NOT BETWEEN 1 AND 160
      OR length(btrim(coalesce(item->>'local',''))) NOT BETWEEN 1 AND 160
      OR length(btrim(coalesce(item->>'specialty',''))) NOT BETWEEN 1 AND 160
      OR coalesce(item->>'week','')<>code
      OR coalesce(item->>'date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
      RAISE EXCEPTION 'Linha inválida: confira semana, data, centro, especialidade, local e HH';
    END IF;
    dt:=(item->>'date')::date;
    IF dt<target_week.start_date OR dt>target_week.end_date THEN RAISE EXCEPTION 'Data fora da semana selecionada'; END IF;
  END LOOP;
  SELECT jsonb_agg(jsonb_build_object(
    'center',upper(regexp_replace(btrim(value->>'center'),'\s+',' ','g')),
    'date',value->>'date','hours',(value->>'hours')::numeric,'week',code,
    'local',upper(regexp_replace(btrim(value->>'local'),'\s+',' ','g')),
    'specialty',regexp_replace(btrim(value->>'specialty'),'\s+',' ','g')
  ) ORDER BY value->>'date',value->>'center',value->>'local') INTO normalized_rows FROM jsonb_array_elements(p_rows);
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(normalized_rows) r GROUP BY r->>'center',r->>'date',r->>'local' HAVING count(*)>1) THEN
    RAISE EXCEPTION 'Centro, data e local duplicados';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(normalized_rows) r GROUP BY r->>'center'
    HAVING count(DISTINCT translate(upper(r->>'specialty'),'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ','AAAAAEEEEIIIIOOOOOUUUUC'))>1) THEN
    RAISE EXCEPTION 'O mesmo centro está vinculado a especialidades diferentes';
  END IF;
  IF p_expected_version=0 THEN
    INSERT INTO public.weekly_rs_availability(week_id,worksite_id,rows,source_file_name,updated_by)
      VALUES(p_week_id,target_week.worksite_id,normalized_rows,nullif(btrim(p_source_file_name),''),auth.uid())
      ON CONFLICT DO NOTHING RETURNING * INTO saved;
  ELSE
    UPDATE public.weekly_rs_availability SET rows=normalized_rows,source_file_name=nullif(btrim(p_source_file_name),''),
      version=version+1,updated_by=auth.uid(),updated_at=now()
      WHERE week_id=p_week_id AND worksite_id=target_week.worksite_id AND version=p_expected_version RETURNING * INTO saved;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'A disponibilidade foi alterada por outra pessoa. Atualize antes de salvar.' USING ERRCODE='40001'; END IF;
  INSERT INTO public.weekly_rs_availability_history(week_id,worksite_id,version,rows,source_file_name,updated_by,updated_at)
    VALUES(saved.week_id,saved.worksite_id,saved.version,saved.rows,saved.source_file_name,saved.updated_by,saved.updated_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_weekly_realization(p_week_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE target_week public.weeks%ROWTYPE; result jsonb;
BEGIN
  SELECT * INTO target_week FROM public.weeks WHERE id=p_week_id;
  IF NOT FOUND OR NOT coalesce(public.can_access_sap(auth.uid()),false)
    OR NOT coalesce(public.can_access_worksite(auth.uid(),target_week.worksite_id),false) THEN
    RAISE EXCEPTION 'Sem acesso à realização semanal desta obra';
  END IF;
  WITH programmed AS MATERIALIZED (
    SELECT a.id,a.scheduled_date,
      upper(regexp_replace(btrim(coalesce(nullif(a.planning_data->>'CenTrab',''),nullif(a.planning_data->>'CENTRO_DE_TRABALHO',''),nullif(a.planning_data->>'Centro de trabalho',''),a.specialty,'')),'\s+',' ','g')) center,
      regexp_replace(regexp_replace(btrim(coalesce(a.planning_data->>'Confirmação',a.planning_data->>'Confirmacao','')),'([,.]0+)$','','g'),'^0+','') confirmation,
      CASE WHEN position(',' in h.cleaned)>0 THEN replace(replace(h.cleaned,'.',''),',','.') ELSE h.cleaned END normalized
    FROM public.activities a
    CROSS JOIN LATERAL (SELECT regexp_replace(btrim(coalesce(a.planning_data->>'Trab',a.planning_data->>'TRAB',a.planning_data->>'trab','')),'\s*h(oras?)?$','','i') cleaned) h
    WHERE a.week_id=p_week_id AND a.worksite_id=target_week.worksite_id AND NOT a.is_immediate
      AND (nullif(btrim(coalesce(a.order_number,'')),'') IS NOT NULL
        OR nullif(btrim(coalesce(a.description,'')),'') IS NOT NULL
        OR nullif(btrim(coalesce(a.planning_data->>'Confirmação',a.planning_data->>'Confirmacao','')),'') IS NOT NULL)
  ), planned AS (
    SELECT coalesce(sum(CASE WHEN normalized ~ '^[0-9]+(\.[0-9]+)?$' THEN normalized::numeric ELSE 0 END),0) hs,
      count(*) tasks,count(*) FILTER(WHERE normalized !~ '^[0-9]+(\.[0-9]+)?$') invalid_hours FROM programmed
  ), latest_import AS (
    SELECT i.id,i.source_file_name,i.imported_at,i.imported_by_name,i.row_count
    FROM public.sap_confirmation_imports i
    WHERE i.week_id=p_week_id AND i.worksite_id=target_week.worksite_id
      AND EXISTS(SELECT 1 FROM public.sap_confirmation_rows r WHERE r.import_id=i.id AND r.worksite_id=target_week.worksite_id)
    ORDER BY i.imported_at DESC,i.id DESC LIMIT 1
  ), classified AS MATERIALIZED (
    SELECT s.*,
      CASE WHEN EXISTS(SELECT 1 FROM programmed p WHERE p.confirmation<>'' AND p.confirmation=regexp_replace(regexp_replace(btrim(coalesce(s.confirmation,'')),'([,.]0+)$','','g'),'^0+','')
        AND p.scheduled_date BETWEEN coalesce(s.actual_start_date,s.actual_end_date,p.scheduled_date)
          AND coalesce(s.actual_end_date,s.actual_start_date,p.scheduled_date)) THEN 'programmed'
        WHEN regexp_replace(regexp_replace(btrim(coalesce(s.planning_code,'')),'([,.]0+)$','','g'),'^0+','')='2' THEN 'immediate'
        WHEN regexp_replace(regexp_replace(btrim(coalesce(s.planning_code,'')),'([,.]0+)$','','g'),'^0+','')='1' THEN 'unprogrammed'
        ELSE 'unclassified' END category
    FROM public.sap_confirmation_rows s
    WHERE s.import_id=(SELECT id FROM latest_import) AND s.week_id=p_week_id AND s.worksite_id=target_week.worksite_id
      AND s.has_confirmation AND coalesce(s.actual_work,0)>0
  ), planned_centers AS (
    SELECT center,coalesce(sum(CASE WHEN normalized ~ '^[0-9]+(\.[0-9]+)?$' THEN normalized::numeric ELSE 0 END),0) programmed
    FROM programmed GROUP BY center
  ), realized_centers AS (
    SELECT upper(regexp_replace(btrim(coalesce(work_center,'')),'\s+',' ','g')) center,
      coalesce(sum(actual_work) FILTER(WHERE category='programmed'),0) completed,
      coalesce(sum(actual_work) FILTER(WHERE category='immediate'),0) immediate
    FROM classified GROUP BY 1
  ), centers AS (
    SELECT coalesce(p.center,r.center) center,coalesce(p.programmed,0) programmed,coalesce(r.completed,0) completed,coalesce(r.immediate,0) immediate
    FROM planned_centers p FULL JOIN realized_centers r ON r.center=p.center
  ), realized AS (
    SELECT coalesce(sum(actual_work) FILTER(WHERE category='programmed'),0) completed,
      coalesce(sum(actual_work) FILTER(WHERE category='immediate'),0) immediate,
      coalesce(sum(actual_work) FILTER(WHERE category='unprogrammed'),0) unprogrammed,
      coalesce(sum(actual_work) FILTER(WHERE category='unclassified'),0) unclassified,
      count(*) rows,
      count(*) FILTER(WHERE actual_start_date IS NULL AND actual_end_date IS NULL) missing_dates,
      count(*) FILTER(WHERE actual_start_date<target_week.start_date OR actual_end_date>target_week.end_date
        OR actual_end_date<target_week.start_date OR actual_start_date>target_week.end_date) outside_period
    FROM classified
  ) SELECT jsonb_build_object(
    'programmed',(SELECT hs FROM planned),'programmedTasks',(SELECT tasks FROM planned),
    'emptyProgrammedRows',(SELECT count(*) FROM public.activities a WHERE a.week_id=p_week_id AND a.worksite_id=target_week.worksite_id AND NOT a.is_immediate)-(SELECT tasks FROM planned),
    'invalidPlannedHours',(SELECT invalid_hours FROM planned),
    'completed',CASE WHEN EXISTS(SELECT 1 FROM latest_import) THEN (SELECT completed FROM realized) ELSE NULL END,
    'immediate',CASE WHEN EXISTS(SELECT 1 FROM latest_import) THEN (SELECT immediate FROM realized) ELSE NULL END,
    'unprogrammed',(SELECT unprogrammed FROM realized),'unclassified',(SELECT unclassified FROM realized),
    'missingDates',(SELECT missing_dates FROM realized),'outsidePeriod',(SELECT outside_period FROM realized),
    'source',(SELECT to_jsonb(i) FROM latest_import i),
    'centers',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.center) FROM centers c),'[]'::jsonb),
    'previousAvailability',(SELECT to_jsonb(p) || jsonb_build_object(
        'week_code',w.code,'week_start_date',w.start_date,'week_end_date',w.end_date,'updated_by_name',coalesce(u.full_name,'Usuário'))
      FROM public.weekly_rs_availability p JOIN public.weeks w ON w.id=p.week_id
      LEFT JOIN public.profiles u ON u.id=p.updated_by
      WHERE p.worksite_id=target_week.worksite_id AND w.start_date<target_week.start_date
      ORDER BY p.updated_at DESC,p.week_id DESC LIMIT 1),
    'availability',(SELECT to_jsonb(p) || jsonb_build_object('updated_by_name',coalesce(u.full_name,'Usuário'))
      FROM public.weekly_rs_availability p LEFT JOIN public.profiles u ON u.id=p.updated_by
      WHERE p.week_id=p_week_id AND p.worksite_id=target_week.worksite_id)
  ) INTO result;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_weekly_realization(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.save_weekly_rs_availability(uuid,jsonb,integer,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_weekly_realization(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_weekly_rs_availability(uuid,jsonb,integer,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_weekly_rs_availability_history(p_week_id uuid,p_before_version integer DEFAULT NULL,p_limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE target_week public.weeks%ROWTYPE; result jsonb;
BEGIN
  SELECT * INTO target_week FROM public.weeks WHERE id=p_week_id;
  IF NOT FOUND OR NOT coalesce(public.can_access_sap(auth.uid()),false)
    OR NOT coalesce(public.can_access_worksite(auth.uid(),target_week.worksite_id),false) THEN
    RAISE EXCEPTION 'Sem acesso ao histórico de disponibilidade desta semana';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Limite inválido'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.version DESC),'[]'::jsonb) INTO result FROM (
    SELECT h.version,h.updated_at,coalesce(u.full_name,'Usuário') updated_by_name,h.source_file_name,
      jsonb_array_length(h.rows) row_count,
      (SELECT coalesce(sum((r->>'hours')::numeric),0) FROM jsonb_array_elements(h.rows) r) total_hh,
      (SELECT sum((r->>'hours')::numeric) FROM public.weekly_rs_availability_history prev
        CROSS JOIN LATERAL jsonb_array_elements(prev.rows) r
        WHERE prev.week_id=h.week_id AND prev.worksite_id=h.worksite_id AND prev.version=h.version-1) previous_total_hh
    FROM public.weekly_rs_availability_history h LEFT JOIN public.profiles u ON u.id=h.updated_by
    WHERE h.week_id=p_week_id AND h.worksite_id=target_week.worksite_id AND (p_before_version IS NULL OR h.version<p_before_version)
    ORDER BY h.version DESC LIMIT p_limit
  ) x;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.list_weekly_rs_availability_history(uuid,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_weekly_rs_availability_history(uuid,integer,integer) TO authenticated;
