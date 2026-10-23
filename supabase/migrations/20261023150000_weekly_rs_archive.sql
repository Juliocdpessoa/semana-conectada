-- Permanent, versioned weekly evidence. No source cleanup or historic backfill is performed.
CREATE TABLE public.weekly_rs_closures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), week_id uuid NOT NULL REFERENCES public.weeks(id) ON DELETE RESTRICT,
  worksite_id uuid NOT NULL REFERENCES public.worksites(id) ON DELETE RESTRICT,
  version integer NOT NULL, closed_at timestamptz NOT NULL DEFAULT now(), closed_by uuid NOT NULL REFERENCES auth.users(id),
  closed_by_name text NOT NULL, reason text NOT NULL, rule_version text NOT NULL,
  rules jsonb NOT NULL, week_info jsonb NOT NULL, summary jsonb NOT NULL,
  UNIQUE(week_id,version)
);
CREATE INDEX weekly_rs_closures_worksite_date ON public.weekly_rs_closures(worksite_id,closed_at DESC);
CREATE TABLE public.weekly_rs_closure_scopes (
  closure_id uuid NOT NULL REFERENCES public.weekly_rs_closures(id) ON DELETE RESTRICT,
  scope text NOT NULL CHECK(scope IN ('ALL','IARI','ROTINA')), data jsonb NOT NULL,
  PRIMARY KEY(closure_id,scope)
);
CREATE TABLE public.weekly_rs_closure_items (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, closure_id uuid NOT NULL REFERENCES public.weekly_rs_closures(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK(kind IN ('activity','activity_history','sap','sap_import','availability','availability_history')),
  source_id text NOT NULL, local text, record_date date, payload jsonb NOT NULL, evidence jsonb,
  UNIQUE(closure_id,kind,source_id)
);
CREATE INDEX weekly_rs_closure_items_page ON public.weekly_rs_closure_items(closure_id,kind,id);
CREATE INDEX weekly_rs_closure_items_pending ON public.weekly_rs_closure_items(closure_id,local,record_date) WHERE kind='activity';
ALTER TABLE public.weekly_rs_closures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weekly_rs_closure_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weekly_rs_closure_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.weekly_rs_closures,public.weekly_rs_closure_scopes,public.weekly_rs_closure_items FROM anon,authenticated;
GRANT SELECT ON public.weekly_rs_closures,public.weekly_rs_closure_scopes,public.weekly_rs_closure_items TO authenticated;
CREATE POLICY rs_closure_read ON public.weekly_rs_closures FOR SELECT TO authenticated USING(public.can_access_sap(auth.uid()) AND public.can_access_worksite(auth.uid(),worksite_id));
CREATE POLICY rs_scope_read ON public.weekly_rs_closure_scopes FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.weekly_rs_closures c WHERE c.id=closure_id));
CREATE POLICY rs_items_read ON public.weekly_rs_closure_items FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.weekly_rs_closures c WHERE c.id=closure_id));

CREATE FUNCTION public.rs_archive_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN RAISE EXCEPTION 'Histórico preservado: não é permitido alterar ou excluir versões e cargas SAP. Reabra a semana para gerar nova versão.'; END $$;
CREATE TRIGGER rs_closures_immutable BEFORE UPDATE OR DELETE ON public.weekly_rs_closures FOR EACH ROW EXECUTE FUNCTION public.rs_archive_immutable();
CREATE TRIGGER rs_scopes_immutable BEFORE UPDATE OR DELETE ON public.weekly_rs_closure_scopes FOR EACH ROW EXECUTE FUNCTION public.rs_archive_immutable();
CREATE TRIGGER rs_items_immutable BEFORE UPDATE OR DELETE ON public.weekly_rs_closure_items FOR EACH ROW EXECUTE FUNCTION public.rs_archive_immutable();
-- Preserve every original structured SAP load, not just its header or latest status.
CREATE TRIGGER sap_rows_retained BEFORE UPDATE OR DELETE ON public.sap_confirmation_rows FOR EACH ROW EXECUTE FUNCTION public.rs_archive_immutable();
CREATE TRIGGER sap_imports_retained BEFORE UPDATE OR DELETE ON public.sap_confirmation_imports FOR EACH ROW EXECUTE FUNCTION public.rs_archive_immutable();

CREATE FUNCTION public.rs_archive_key(value text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=public AS $$
SELECT upper(regexp_replace(btrim(translate(coalesce(value,''),'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç','AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc')),'\s+',' ','g'));
$$;
-- Versioned server-side formula; frozen results are never recalculated by future client formulas.
CREATE FUNCTION public.rs_archive_calculation(d jsonb, selected_local text DEFAULT NULL) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=public AS $$
WITH av AS MATERIALIZED (
  SELECT public.rs_archive_key(r->>'center') center,public.rs_archive_key(r->>'specialty') specialty_key,btrim(r->>'specialty') specialty,
    public.weekly_rs_included(r->>'center',r->>'specialty') included,(r->>'hours')::numeric available
  FROM jsonb_array_elements(coalesce(d->'availability'->'rows','[]')) r
  WHERE selected_local IS NULL OR upper(btrim(r->>'local'))=selected_local
), all_mapping AS (
  SELECT public.rs_archive_key(r->>'center') center,min(r->>'specialty') specialty FROM jsonb_array_elements(coalesce(d->'availability'->'rows','[]')) r GROUP BY 1
), mapping AS (SELECT center,min(specialty_key) specialty_key,min(specialty) specialty,bool_and(included) included,sum(available) available FROM av GROUP BY center),
amounts AS (
  SELECT public.rs_archive_key(c->>'center') center,sum((c->>'programmed')::numeric) programmed,sum((c->>'completed')::numeric) completed,
    sum(coalesce((c->>'completedForRs')::numeric,(c->>'completed')::numeric)) credited,sum((c->>'immediate')::numeric) immediate
  FROM jsonb_array_elements(coalesce(d->'centers','[]')) c GROUP BY 1
), centers AS (
  SELECT coalesce(m.center,a.center) center,coalesce(m.specialty,am.specialty,'Centro '||a.center) specialty,
    coalesce(m.specialty_key,public.rs_archive_key(coalesce(am.specialty,'Centro '||a.center))) specialty_key,
    coalesce(m.included,public.weekly_rs_included(a.center,am.specialty)) included,
    coalesce(m.available,0) available,coalesce(a.programmed,0) programmed,coalesce(a.completed,0) completed,
    coalesce(a.credited,0) credited,coalesce(a.immediate,0) immediate,m.center IS NOT NULL mapped
  FROM mapping m FULL JOIN amounts a ON a.center=m.center LEFT JOIN all_mapping am ON am.center=a.center
), group_base AS (
  SELECT specialty_key,min(specialty) specialty,included,array_agg(center ORDER BY center) centers,sum(available) available,
    sum(programmed) programmed,sum(completed) completed,sum(credited) credited,sum(immediate) immediate
  FROM centers WHERE mapped OR NOT included GROUP BY specialty_key,included
), group_rows AS (
  SELECT specialty,included AS "includedInRs",centers,available,programmed,completed,credited AS "completedForRs",immediate,
    completed+immediate actual,least(credited+immediate,available) considered,least(programmed,available) AS "programmedConsidered",
    greatest(0,completed+immediate-least(credited+immediate,available)) excess,
    CASE WHEN available>0 THEN least(programmed/available,1) END occupation,
    CASE WHEN d->'source'<>'null'::jsonb AND available>0 THEN least(credited+immediate,available)/available*100 END rs
  FROM group_base
), totals AS (
  SELECT coalesce(sum(available),0) available,coalesce(sum(programmed),0) programmed,coalesce(sum(completed),0) completed,
    coalesce(sum("completedForRs"),0) AS "completedForRs",coalesce(sum(immediate),0) immediate,
    coalesce(sum(considered),0) considered,coalesce(sum(excess),0) excess FROM group_rows WHERE "includedInRs"
), validity AS (
  SELECT (d->'source'<>'null'::jsonb AND d->'availability'<>'null'::jsonb
    AND coalesce((d->>'invalidPlannedHours')::int,0)=0 AND coalesce((d->>'unresolvedLocal')::int,0)=0
    AND NOT EXISTS(SELECT 1 FROM av WHERE available<0)
    AND NOT EXISTS(SELECT 1 FROM av GROUP BY center HAVING count(DISTINCT specialty_key)>1)
    AND NOT EXISTS(SELECT 1 FROM centers WHERE programmed<0 OR completed<0 OR credited<0 OR immediate<0)
    AND NOT EXISTS(SELECT 1 FROM centers WHERE NOT mapped AND included AND (programmed>0 OR completed>0 OR immediate>0))) valid
), center_rows AS (
  SELECT c.center,c.specialty,ARRAY[c.center] centers,c.included AS "includedInRs",c.available,c.programmed,c.completed,c.credited AS "completedForRs",c.immediate,c.completed+c.immediate actual,
    least(c.programmed,c.available) AS "programmedConsidered",least(c.credited+c.immediate,c.available) considered,
    greatest(0,c.completed+c.immediate-least(c.credited+c.immediate,c.available)) excess,
    CASE WHEN c.available>0 THEN least(c.programmed/c.available,1) END occupation,
    CASE WHEN d->'source'<>'null'::jsonb AND c.available>0 THEN least(c.credited+c.immediate,c.available)/c.available*100 END rs
  FROM centers c WHERE c.mapped
)
SELECT jsonb_build_object('rows',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY specialty) FROM group_rows r),'[]'),
 'centerRows',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY center) FROM center_rows r),'[]'),
 'totals',(SELECT to_jsonb(t) FROM totals t),'monitoring',coalesce((SELECT jsonb_agg(to_jsonb(r)) FROM group_rows r WHERE NOT "includedInRs"),'[]'),
 'unmapped',coalesce((SELECT jsonb_agg(center) FROM centers WHERE NOT mapped AND included AND (programmed>0 OR completed>0 OR immediate>0)),'[]'),'invalid','[]'::jsonb,
 'result',(SELECT CASE WHEN v.valid AND t.available>0 AND t.programmed>0 THEN jsonb_build_object(
   'occupation',least(t.programmed,t.available)/t.available,'rs',t.considered/t.available*100,
   'factor',CASE WHEN t.considered*100<t.available*95 THEN -0.02 WHEN t.considered*100<t.available*98 THEN -0.01 WHEN t.considered<=t.available THEN 0 ELSE 0.01 END,
   'totalCompleted',t.considered,'reference',t.available,'programmedConsidered',least(t.programmed,t.available),'at95',t.considered*100=t.available*95) END FROM totals t CROSS JOIN validity v));
$$;
REVOKE ALL ON FUNCTION public.rs_archive_calculation(jsonb,text) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.capture_weekly_rs_closure(p_week_id uuid,p_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
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
  VALUES(w.id,w.worksite_id,v,auth.uid(),actor,left(btrim(p_reason),500),'rs-hh-2026-10-23-v1',
    jsonb_build_object('source','Última carga SAP detalhada da semana','programmedCredit','min(SAP,programado) por confirmação',
      'cap','semanal por especialidade','occupationCap',1,'availabilityIncludesEep',true,'factors','<95:-0.02;95<=RS<98:-0.01;98<=RS<=100:0;>100:+0.01',
      'excludedCenters',jsonb_build_array('INSPPINT','TECNIEND','TECNINSC','HIDROJATO'),'excludedSpecialties',jsonb_build_array('ALPINISTA','ALPINISTAS','ALPINISMO')),
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
  RETURN cid;
END $$;
REVOKE ALL ON FUNCTION public.capture_weekly_rs_closure(uuid,text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.close_sap_week(p_week_id uuid,p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE w public.weeks%ROWTYPE; actor public.profiles%ROWTYPE;
BEGIN
  PERFORM public.assert_sap_closure_admin(p_week_id);
  SELECT * INTO w FROM public.weeks WHERE id=p_week_id FOR UPDATE;
  PERFORM public.capture_weekly_rs_closure(p_week_id,p_reason);
  IF w.sap_closure_status='closed' THEN RETURN; END IF;
  SELECT * INTO actor FROM public.profiles WHERE id=auth.uid();
  UPDATE public.weeks SET sap_closure_status='closed',sap_closed_at=now(),sap_closed_by=auth.uid() WHERE id=p_week_id;
  INSERT INTO public.sap_week_closure_history(worksite_id,week_id,action,previous_deadline,new_deadline,reason,changed_by,changed_by_name,changed_by_email)
    VALUES(w.worksite_id,w.id,'closed',w.sap_closure_deadline,w.sap_closure_deadline,left(btrim(p_reason),500),auth.uid(),actor.full_name,actor.email);
END $$;

CREATE FUNCTION public.guard_rs_week_source_write() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE w public.weeks%ROWTYPE;
BEGIN
  SELECT * INTO w FROM public.weeks WHERE id=NEW.week_id FOR UPDATE;
  IF w.sap_closure_status='closed' THEN RAISE EXCEPTION 'Semana fechada. O administrador deve reabrir o fechamento antes de alterar SAP ou disponibilidade.'; END IF;
  IF TG_TABLE_NAME='sap_confirmation_imports' AND w.sap_closure_deadline IS NOT NULL AND now()>w.sap_closure_deadline THEN
    RAISE EXCEPTION 'Prazo SAP encerrado. Solicite reabertura ou prorrogação ao administrador.'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER rs_sap_import_lock BEFORE INSERT ON public.sap_confirmation_imports FOR EACH ROW EXECUTE FUNCTION public.guard_rs_week_source_write();
CREATE TRIGGER rs_availability_lock BEFORE INSERT OR UPDATE ON public.weekly_rs_availability FOR EACH ROW EXECUTE FUNCTION public.guard_rs_week_source_write();

CREATE FUNCTION public.get_weekly_rs_report(p_week_id uuid,p_local text DEFAULT NULL,p_version integer DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE w public.weeks%ROWTYPE; c public.weekly_rs_closures%ROWTYPE; d jsonb; selected_scope text:=coalesce(nullif(upper(btrim(p_local)),''),'ALL');
BEGIN
  SELECT * INTO w FROM public.weeks WHERE id=p_week_id;
  IF NOT FOUND OR NOT coalesce(public.can_access_sap(auth.uid()),false) OR NOT coalesce(public.can_access_worksite(auth.uid(),w.worksite_id),false) THEN RAISE EXCEPTION 'Sem acesso ao RS desta obra'; END IF;
  IF selected_scope NOT IN ('ALL','IARI','ROTINA') THEN RAISE EXCEPTION 'Local inválido'; END IF;
  IF p_version IS NOT NULL OR w.sap_closure_status='closed' THEN
    SELECT * INTO c FROM public.weekly_rs_closures WHERE week_id=p_week_id AND (p_version IS NULL OR version=p_version) ORDER BY version DESC LIMIT 1;
    IF p_version IS NOT NULL AND NOT FOUND THEN RAISE EXCEPTION 'Versão de fechamento não encontrada'; END IF;
    IF c.id IS NOT NULL THEN
      SELECT data INTO d FROM public.weekly_rs_closure_scopes WHERE closure_id=c.id AND scope=selected_scope;
      RETURN d||jsonb_build_object('closure',to_jsonb(c),'rules',c.rules,'isFrozen',true);
    END IF;
  END IF;
  RETURN public.get_weekly_rs_analysis(p_week_id,CASE WHEN selected_scope='ALL' THEN NULL ELSE selected_scope END)||jsonb_build_object('isFrozen',false,'closure',NULL,
    'legacyClosedWithoutSnapshot',w.sap_closure_status='closed','deadlinePassed',w.sap_closure_deadline IS NOT NULL AND now()>w.sap_closure_deadline);
END $$;
REVOKE ALL ON FUNCTION public.get_weekly_rs_report(uuid,text,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_weekly_rs_report(uuid,text,integer) TO authenticated;

CREATE FUNCTION public.list_weekly_rs_closures(p_week_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE w public.weeks%ROWTYPE; result jsonb;
BEGIN
 SELECT * INTO w FROM public.weeks WHERE id=p_week_id;
 IF NOT FOUND OR NOT coalesce(public.can_access_sap(auth.uid()),false) OR NOT coalesce(public.can_access_worksite(auth.uid(),w.worksite_id),false) THEN RAISE EXCEPTION 'Sem acesso ao histórico RS'; END IF;
 SELECT jsonb_build_object('status',w.sap_closure_status,'deadline',w.sap_closure_deadline,'versions',coalesce(jsonb_agg(jsonb_build_object('id',id,'version',version,'closed_at',closed_at,'closed_by_name',closed_by_name,'reason',reason,'rule_version',rule_version,'summary',summary) ORDER BY version DESC) FILTER(WHERE id IS NOT NULL),'[]')) INTO result
 FROM public.weekly_rs_closures WHERE week_id=p_week_id AND worksite_id=w.worksite_id;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.list_weekly_rs_closures(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_weekly_rs_closures(uuid) TO authenticated;

CREATE FUNCTION public.get_weekly_rs_closure_items(p_closure_id uuid,p_kind text,p_offset integer DEFAULT 0,p_limit integer DEFAULT 500) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE c public.weekly_rs_closures%ROWTYPE; result jsonb;
BEGIN
 SELECT * INTO c FROM public.weekly_rs_closures WHERE id=p_closure_id;
 IF NOT FOUND OR NOT coalesce(public.can_access_sap(auth.uid()),false) OR NOT coalesce(public.can_access_worksite(auth.uid(),c.worksite_id),false) THEN RAISE EXCEPTION 'Sem acesso ao arquivo RS'; END IF;
 IF p_kind NOT IN ('activity','activity_history','sap','sap_import','availability','availability_history') OR p_offset<0 OR p_offset IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Paginação inválida'; END IF;
 SELECT jsonb_build_object('total',(SELECT count(*) FROM public.weekly_rs_closure_items WHERE closure_id=c.id AND kind=p_kind),
  'rows',coalesce(jsonb_agg(payload ORDER BY id),'[]')) INTO result FROM (SELECT id,payload||CASE WHEN evidence IS NOT NULL THEN jsonb_build_object('archived_evidence',evidence) ELSE '{}'::jsonb END payload FROM public.weekly_rs_closure_items WHERE closure_id=c.id AND kind=p_kind ORDER BY id LIMIT p_limit OFFSET p_offset) page;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.get_weekly_rs_closure_items(uuid,text,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_weekly_rs_closure_items(uuid,text,integer,integer) TO authenticated;

CREATE FUNCTION public.get_weekly_rs_closure_pending(p_closure_id uuid,p_local text DEFAULT NULL,p_offset integer DEFAULT 0,p_limit integer DEFAULT 50,
 p_justification text DEFAULT NULL,p_only_missing_justification boolean DEFAULT false,p_include_monitoring boolean DEFAULT false,p_query text DEFAULT '') RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE c public.weekly_rs_closures%ROWTYPE; result jsonb;
BEGIN
 SELECT * INTO c FROM public.weekly_rs_closures WHERE id=p_closure_id;
 IF NOT FOUND OR NOT coalesce(public.can_access_sap(auth.uid()),false) OR NOT coalesce(public.can_access_worksite(auth.uid(),c.worksite_id),false) THEN RAISE EXCEPTION 'Sem acesso às pendências arquivadas'; END IF;
 IF p_offset IS NULL OR p_offset<0 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR length(coalesce(p_query,''))>200 OR length(coalesce(p_justification,''))>200 OR (p_local IS NOT NULL AND p_local NOT IN ('IARI','ROTINA')) THEN RAISE EXCEPTION 'Filtros inválidos'; END IF;
 WITH filtered AS MATERIALIZED (
  SELECT i.id,i.evidence e FROM public.weekly_rs_closure_items i WHERE i.closure_id=c.id AND kind='activity'
   AND i.evidence->>'sap_state' IN ('sem_apropriacao','sem_confirmacao') AND (p_local IS NULL OR i.local=p_local)
   AND (p_include_monitoring OR (i.evidence->>'included_in_rs')::boolean)
   AND (p_justification IS NULL OR i.evidence->>'justification'=p_justification)
   AND (NOT p_only_missing_justification OR i.evidence->>'justification' IS NULL)
   AND (coalesce(p_query,'')='' OR concat_ws(' ',i.evidence->>'order_number',i.evidence->>'operation',i.evidence->>'confirmation',i.evidence->>'description') ILIKE '%'||p_query||'%')
 ), page AS (SELECT * FROM filtered ORDER BY (e->>'status'='EXECUTADO') DESC,e->>'scheduled_date',id LIMIT p_limit OFFSET p_offset)
 SELECT jsonb_build_object('total',(SELECT count(*) FROM filtered),'rows',coalesce((SELECT jsonb_agg(e ORDER BY (e->>'status'='EXECUTADO') DESC,e->>'scheduled_date',id) FROM page),'[]')) INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.get_weekly_rs_closure_pending(uuid,text,integer,integer,text,boolean,boolean,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_weekly_rs_closure_pending(uuid,text,integer,integer,text,boolean,boolean,text) TO authenticated;
-- Canonical append-only importer: supersedes earlier cleanup migrations.
CREATE OR REPLACE FUNCTION public.import_sap_confirmations(p_week_id uuid, p_source_file_name text, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  target_week public.weeks%ROWTYPE;
  new_import_id uuid;
  imported_count integer;
BEGIN
  IF NOT public.is_approved(auth.uid())
    OR NOT public.can_access_sap(auth.uid()) THEN
    RAISE EXCEPTION 'Somente Planejamento ou Administrador pode importar confirmações SAP.';
  END IF;

  SELECT * INTO target_week FROM public.weeks WHERE id = p_week_id;
  IF NOT FOUND OR NOT public.can_access_worksite(auth.uid(), target_week.worksite_id) THEN
    RAISE EXCEPTION 'Semana não encontrada ou sem acesso.';
  END IF;

  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) < 1
    OR jsonb_array_length(p_rows) > 5000 THEN
    RAISE EXCEPTION 'A planilha deve conter entre 1 e 5000 linhas.';
  END IF;

  IF nullif(btrim(p_source_file_name), '') IS NULL THEN
    RAISE EXCEPTION 'Nome do arquivo não informado.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_rows) item
    WHERE nullif(btrim(item->>'order_number'), '') IS NULL
       OR nullif(btrim(item->>'confirmation'), '') IS NULL
  ) THEN
    RAISE EXCEPTION 'Todas as linhas precisam ter Ordem e Confirmação.';
  END IF;

  INSERT INTO public.sap_confirmation_imports (
    worksite_id, week_id, source_file_name, source_label, row_count, imported_by, imported_by_name, imported_by_email
  ) VALUES (
    target_week.worksite_id,
    target_week.id,
    left(btrim(p_source_file_name), 240),
    'Importação pela tela de Atividades',
    jsonb_array_length(p_rows),
    auth.uid(),
    (SELECT full_name FROM public.profiles WHERE id=auth.uid()),
    (SELECT email FROM public.profiles WHERE id=auth.uid())
  ) RETURNING id INTO new_import_id;

  INSERT INTO public.sap_confirmation_rows (
    import_id, worksite_id, week_id, source_row_number, order_number, operation,
    suboperation, planning_code, work_center, description, actual_start_date,
    actual_end_date, system_status, normal_duration, planned_work, actual_work,
    user_status, operational_area, confirmation
  )
  SELECT
    new_import_id,
    target_week.worksite_id,
    target_week.id,
    coalesce((item->>'source_row_number')::integer, ordinality::integer + 1),
    btrim(item->>'order_number'),
    nullif(btrim(item->>'operation'), ''),
    nullif(btrim(item->>'suboperation'), ''),
    nullif(btrim(item->>'planning_code'), ''),
    nullif(btrim(item->>'work_center'), ''),
    nullif(btrim(item->>'description'), ''),
    nullif(item->>'actual_start_date', '')::date,
    nullif(item->>'actual_end_date', '')::date,
    nullif(btrim(item->>'system_status'), ''),
    nullif(item->>'normal_duration', '')::numeric,
    nullif(item->>'planned_work', '')::numeric,
    nullif(item->>'actual_work', '')::numeric,
    nullif(btrim(item->>'user_status'), ''),
    nullif(btrim(item->>'operational_area'), ''),
    btrim(item->>'confirmation')
  FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS source(item, ordinality);

  GET DIAGNOSTICS imported_count = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'importId', new_import_id, 'count', imported_count);
END;
$function$
;
-- All loads remain available, while operational calculations use only the latest.
CREATE FUNCTION public.list_weekly_sap_loads(p_week_id uuid,p_offset integer DEFAULT 0,p_limit integer DEFAULT 10) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE w public.weeks%ROWTYPE; result jsonb;
BEGIN
 SELECT * INTO w FROM public.weeks WHERE id=p_week_id;
 IF NOT FOUND OR NOT coalesce(public.can_access_sap(auth.uid()),false) OR NOT coalesce(public.can_access_worksite(auth.uid(),w.worksite_id),false) THEN RAISE EXCEPTION 'Sem acesso às cargas SAP'; END IF;
 IF p_offset IS NULL OR p_offset<0 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'Paginação inválida'; END IF;
 SELECT jsonb_build_object('total',(SELECT count(*) FROM public.sap_confirmation_imports WHERE week_id=w.id AND worksite_id=w.worksite_id),
 'rows',coalesce(jsonb_agg(to_jsonb(page) ORDER BY imported_at DESC,id DESC),'[]')) INTO result FROM (
 SELECT i.id,i.source_file_name,i.imported_at,i.row_count,coalesce(i.imported_by_name,p.full_name,'Não identificado') imported_by_name
 FROM public.sap_confirmation_imports i LEFT JOIN public.profiles p ON p.id=i.imported_by
 WHERE i.week_id=w.id AND i.worksite_id=w.worksite_id ORDER BY i.imported_at DESC,i.id DESC LIMIT p_limit OFFSET p_offset) page;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.list_weekly_sap_loads(uuid,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_weekly_sap_loads(uuid,integer,integer) TO authenticated;
CREATE FUNCTION public.get_weekly_sap_load_rows(p_import_id uuid,p_offset integer DEFAULT 0,p_limit integer DEFAULT 500) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE i public.sap_confirmation_imports%ROWTYPE; result jsonb;
BEGIN
 SELECT * INTO i FROM public.sap_confirmation_imports WHERE id=p_import_id;
 IF NOT FOUND OR NOT coalesce(public.can_access_sap(auth.uid()),false) OR NOT coalesce(public.can_access_worksite(auth.uid(),i.worksite_id),false) THEN RAISE EXCEPTION 'Sem acesso à carga SAP'; END IF;
 IF p_offset IS NULL OR p_offset<0 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Paginação inválida'; END IF;
 SELECT jsonb_build_object('total',(SELECT count(*) FROM public.sap_confirmation_rows WHERE import_id=i.id AND worksite_id=i.worksite_id),
 'rows',coalesce(jsonb_agg(to_jsonb(page) ORDER BY source_row_number,id),'[]')) INTO result FROM (
 SELECT r.* FROM public.sap_confirmation_rows r WHERE r.import_id=i.id AND r.worksite_id=i.worksite_id ORDER BY r.source_row_number,r.id LIMIT p_limit OFFSET p_offset) page;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.get_weekly_sap_load_rows(uuid,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_weekly_sap_load_rows(uuid,integer,integer) TO authenticated;
NOTIFY pgrst,'reload schema';
