-- Business version conflicts must return HTTP 409, never a retryable serialization error.
-- All row locks, authorization, expected versions and audit triggers are preserved.
CREATE OR REPLACE FUNCTION public.decide_overtime_batch(p_request_id uuid, p_expected_version integer, p_snapshot jsonb, p_decision text, p_comment text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE actor uuid:=auth.uid(); profile public.profiles%ROWTYPE; target public.overtime_requests%ROWTYPE;
 locked_row public.overtime_requests%ROWTYPE; actual jsonb:='[]'; expected jsonb;
 locked_ids uuid[]:='{}'; pending_count integer:=0; changed jsonb; changed_count integer;
BEGIN
 IF NOT coalesce(public.is_approved(actor),false) OR NOT (
 public.has_role(actor,'manager') OR public.has_role(actor,'admin')) THEN
 RETURN jsonb_build_object('ok',false,'error','Somente gerente ou administrador aprovado pode decidir.');
 END IF;
 SELECT * INTO profile FROM public.profiles WHERE id=actor;
 IF p_decision IS NULL OR p_decision NOT IN ('approved','rejected') OR p_expected_version IS NULL OR p_expected_version<1
 OR length(coalesce(p_comment,''))>2000 OR (p_decision='rejected' AND btrim(coalesce(p_comment,''))='') THEN
 RETURN jsonb_build_object('ok',false,'error','Decisão, versão ou comentário inválido.');
 END IF;
 SELECT * INTO target FROM public.overtime_requests WHERE id=p_request_id AND worksite_id=profile.worksite_id;
 IF NOT FOUND OR NOT coalesce(public.can_access_worksite(actor,target.worksite_id),false) THEN
 RETURN jsonb_build_object('ok',false,'error','Solicitação não encontrada nesta obra.');
 END IF;
 IF p_snapshot IS NULL OR jsonb_typeof(p_snapshot)<>'array' THEN RAISE EXCEPTION 'Snapshot inválido'; END IF;
 IF jsonb_array_length(p_snapshot) NOT BETWEEN 1 AND 5000 THEN RAISE EXCEPTION 'Snapshot inválido'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(p_snapshot) s(id uuid,version int,status text)
 WHERE s.id IS NULL OR s.version IS NULL OR s.version<1 OR s.status IS NULL OR s.status NOT IN ('pending','cancelled','approved','rejected'))
 OR (SELECT count(*) FROM jsonb_to_recordset(p_snapshot) s(id uuid))<>(SELECT count(DISTINCT id) FROM jsonb_to_recordset(p_snapshot) s(id uuid)) THEN
 RAISE EXCEPTION 'Snapshot inválido';
 END IF;
 SELECT jsonb_agg(jsonb_build_object('id',s.id,'version',s.version,'status',s.status) ORDER BY s.id)
 INTO expected FROM jsonb_to_recordset(p_snapshot) s(id uuid,version int,status text);
 -- Serialize competing decisions, then lock all existing members in a fixed order.
 PERFORM pg_advisory_xact_lock(hashtextextended('overtime-decision:'||target.worksite_id::text||':'||coalesce(target.batch_id,target.id)::text,0));
 FOR locked_row IN SELECT * FROM public.overtime_requests r
 WHERE r.worksite_id=target.worksite_id AND (
  (target.batch_id IS NOT NULL AND r.batch_id=target.batch_id) OR (target.batch_id IS NULL AND r.id=target.id))
 ORDER BY r.id FOR UPDATE LOOP
  actual:=actual||jsonb_build_array(jsonb_build_object('id',locked_row.id,'version',locked_row.version,'status',locked_row.status));
  locked_ids:=array_append(locked_ids,locked_row.id);
  IF locked_row.status='pending' THEN pending_count:=pending_count+1; END IF;
  IF locked_row.id=p_request_id THEN target:=locked_row; END IF;
 END LOOP;
 IF NOT p_request_id=ANY(locked_ids) THEN
 RETURN jsonb_build_object('ok',false,'conflict',true,'reason','changed','error','O lote foi alterado. A lista será atualizada.');
 END IF;
 IF target.status<>'pending' THEN
 RETURN jsonb_build_object('ok',false,'conflict',true,'reason','decided','error','Este registro não está mais pendente. A lista será atualizada.');
 END IF;
 IF target.version<>p_expected_version OR actual IS DISTINCT FROM expected THEN
 RETURN jsonb_build_object('ok',false,'conflict',true,'reason','changed','error','A solicitação foi alterada desde a consulta. Confira a lista atualizada e tente novamente.');
 END IF;
 WITH updated AS (
 UPDATE public.overtime_requests r SET status=p_decision,manager_comment=nullif(btrim(p_comment),''),
 decided_by_user_id=actor,decided_by_name=profile.full_name,decided_by_email=profile.email,
 decided_at=now(),version=r.version+1
 WHERE r.id=ANY(locked_ids) AND r.worksite_id=target.worksite_id AND r.status='pending'
 RETURNING r.id,r.status,r.version
 ) SELECT coalesce(jsonb_agg(to_jsonb(updated)),'[]'),count(*) INTO changed,changed_count FROM updated;
 IF changed_count<>pending_count THEN RAISE EXCEPTION 'O lote foi alterado; nenhuma decisão foi salva.' USING ERRCODE='PT409'; END IF;
 RETURN jsonb_build_object('ok',true,'count',changed_count,'updated',changed);
END $function$
;

CREATE OR REPLACE FUNCTION public.patch_activity_planning_fields(p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r jsonb; a public.activities%ROWTYPE; k text; actual jsonb; before_value text; next_value text;
 full_access boolean; operation_access boolean; n integer:=0; changed integer; saved jsonb:='[]'::jsonb;
BEGIN
 IF NOT coalesce(public.password_access_allowed(),false) THEN RAISE EXCEPTION 'Redefina sua senha antes de continuar'; END IF;
 full_access:=auth.uid() IS NOT NULL AND (public.has_role(auth.uid(),'planning') OR public.has_role(auth.uid(),'admin'));
 operation_access:=auth.uid() IS NOT NULL AND public.has_role(auth.uid(),'operation');
 IF NOT coalesce(full_access OR operation_access,false) THEN RAISE EXCEPTION 'Sem permissão de edição'; END IF;
 IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Selecione entre 1 e 500 atividades'; END IF;
 IF NOT full_access AND jsonb_array_length(p_rows)<>1 THEN RAISE EXCEPTION 'Operação pode alterar uma atividade por vez'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) x GROUP BY x->>'id' HAVING count(*)>1) THEN RAISE EXCEPTION 'Atividade duplicada'; END IF;
 -- Older tabs must refresh instead of sending a full stale row.
 FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
  IF jsonb_typeof(r->'fields') IS DISTINCT FROM 'array' OR jsonb_array_length(r->'fields') NOT BETWEEN 1 AND 6
   OR jsonb_typeof(r->'expected_values') IS DISTINCT FROM 'object'
   OR (r->>'expected_version') IS NULL THEN RAISE EXCEPTION 'Atualize a página antes de editar. Nova proteção de salvamento disponível.'; END IF;
 END LOOP;
 PERFORM x.id FROM public.activities x JOIN jsonb_array_elements(p_rows) p ON x.id=(p->>'id')::uuid ORDER BY x.id FOR UPDATE OF x;
 FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
  SELECT * INTO a FROM public.activities WHERE id=(r->>'id')::uuid;
  IF NOT FOUND OR NOT coalesce(public.can_access_worksite(auth.uid(),a.worksite_id),false) THEN RAISE EXCEPTION 'Atividade inexistente ou sem acesso à obra'; END IF;
  IF a.version IS DISTINCT FROM (r->>'expected_version')::integer THEN
   RAISE EXCEPTION 'A tarefa recebeu atualizações. Atualize a lista e confira o campo antes de salvar.' USING ERRCODE='PT409'; END IF;
  actual:=to_jsonb(a)||jsonb_build_object('libra',a.planning_data->>'LIBRA');
  FOR k IN SELECT jsonb_array_elements_text(r->'fields') LOOP
   IF k NOT IN ('pbs','pt_number','pt_color','release_type','libra','scheduled_date')
   OR NOT (r ? k) OR NOT ((r->'expected_values') ? k) THEN RAISE EXCEPTION 'Campos de edição inválidos'; END IF;
   IF NOT full_access AND k NOT IN ('pt_number','pt_color','libra') THEN RAISE EXCEPTION 'Operação pode alterar somente número, cor da PT e LIBRA'; END IF;
   IF jsonb_typeof(r->k) NOT IN ('string','null') OR length(coalesce(r->>k,''))>120 THEN RAISE EXCEPTION 'Valor inválido'; END IF;
   before_value:=nullif(btrim(actual->>k),''); next_value:=nullif(btrim(r->>k),'');
   IF before_value IS DISTINCT FROM nullif(btrim(r->'expected_values'->>k),'') THEN
    RAISE EXCEPTION 'Este campo foi atualizado. Recarregue a lista antes de editar.' USING ERRCODE='PT409'; END IF;
   IF k='pt_color' AND next_value IS NOT NULL AND next_value NOT IN ('red','yellow','white') THEN RAISE EXCEPTION 'Cor inválida'; END IF;
   IF k='release_type' AND next_value IS NOT NULL AND next_value NOT IN ('PT','PTT','ATRE','OFICINAS') THEN RAISE EXCEPTION 'Tipo de liberação inválido'; END IF;
  END LOOP;
  IF (CASE WHEN r->'fields' ? 'release_type' THEN nullif(btrim(r->>'release_type'),'') ELSE a.release_type END) IN ('ATRE','OFICINAS')
   AND (CASE WHEN r->'fields' ? 'pt_color' THEN nullif(btrim(r->>'pt_color'),'') ELSE a.pt_color END) IS NOT NULL THEN RAISE EXCEPTION 'Este tipo de liberação não possui cor de PT'; END IF;
  -- Do not issue UPDATE for an unchanged field: no version or history noise.
  IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(r->'fields') f WHERE nullif(btrim(actual->>f),'') IS DISTINCT FROM nullif(btrim(r->>f),'')) THEN
   UPDATE public.activities SET
    pbs=CASE WHEN r->'fields' ? 'pbs' THEN nullif(btrim(r->>'pbs'),'') ELSE pbs END,
    pt_number=CASE WHEN r->'fields' ? 'pt_number' THEN nullif(btrim(r->>'pt_number'),'') ELSE pt_number END,
    pt_color=CASE WHEN r->'fields' ? 'pt_color' THEN nullif(btrim(r->>'pt_color'),'') ELSE pt_color END,
    release_type=CASE WHEN r->'fields' ? 'release_type' THEN nullif(btrim(r->>'release_type'),'') ELSE release_type END,
    scheduled_date=CASE WHEN r->'fields' ? 'scheduled_date' THEN nullif(btrim(r->>'scheduled_date'),'')::date ELSE scheduled_date END,
    planning_data=coalesce(planning_data,'{}'::jsonb)
     ||CASE WHEN r->'fields' ? 'libra' THEN jsonb_build_object('LIBRA',nullif(btrim(r->>'libra'),'')) ELSE '{}'::jsonb END
     ||CASE WHEN r->'fields' ? 'scheduled_date' THEN jsonb_build_object('Data início',nullif(btrim(r->>'scheduled_date'),'')) ELSE '{}'::jsonb END
   WHERE id=a.id;
   n:=n+1;
  END IF;
  SELECT to_jsonb(x) INTO actual FROM (SELECT id,version,pbs,pt_number,pt_color,release_type,scheduled_date,jsonb_build_object('LIBRA',planning_data->>'LIBRA') planning_data FROM public.activities WHERE id=a.id)x;
  saved:=saved||jsonb_build_array(actual);
 END LOOP;
 RETURN jsonb_build_object('count',n,'rows',saved);
END $function$
;

CREATE OR REPLACE FUNCTION public.save_continuous_activity(p_worksite uuid, p_key text, p_data jsonb, p_id uuid DEFAULT NULL::uuid, p_version integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE cfg public.activity_page_configs%ROWTYPE; old public.continuous_activities%ROWTYPE; saved public.continuous_activities%ROWTYPE; field_item jsonb; actor_name text;
BEGIN
 IF NOT coalesce(public.password_access_allowed(),false) OR NOT coalesce(public.can_access_sap(auth.uid()),false) OR NOT coalesce(public.can_access_worksite(auth.uid(),p_worksite),false) THEN RAISE EXCEPTION 'Sem permissão para editar atividades desta obra'; END IF;
 SELECT * INTO cfg FROM public.activity_page_configs WHERE worksite_id=p_worksite;
 IF NOT FOUND OR jsonb_typeof(p_data)<>'object' OR length(p_data::text)>50000 OR length(btrim(p_key)) NOT BETWEEN 1 AND 20000 THEN RAISE EXCEPTION 'Registro inválido'; END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(cfg.statuses) s WHERE s->>'key'=p_data->>'status' AND coalesce((s->>'active')::boolean,true)) AND NOT EXISTS(SELECT 1 FROM public.continuous_activities a WHERE a.id=p_id AND a.worksite_id=p_worksite AND a.data->>'status'=p_data->>'status') THEN RAISE EXCEPTION 'Status inválido ou desativado'; END IF;
 IF length(btrim(coalesce(p_data->>'description',''))) NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'Informe a solicitação'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_data) k WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(cfg.fields) f WHERE f->>'key'=k)) THEN RAISE EXCEPTION 'Campo não configurado'; END IF;
 FOR field_item IN SELECT * FROM jsonb_array_elements(cfg.fields) LOOP
 IF nullif(p_data->> (field_item->>'key'),'') IS NOT NULL THEN
 IF field_item->>'type'='number' AND (jsonb_typeof(p_data->(field_item->>'key'))<>'number' OR (p_data->>(field_item->>'key'))::numeric<0) THEN RAISE EXCEPTION 'Valor numérico inválido: %',field_item->>'label'; END IF;
 IF field_item->>'type'='date' THEN PERFORM (p_data->>(field_item->>'key'))::date; END IF;
 END IF; END LOOP;
 SELECT full_name INTO actor_name FROM public.profiles WHERE id=auth.uid();
 IF p_id IS NULL THEN
 INSERT INTO public.continuous_activities(worksite_id,record_key,data,updated_by,updated_by_name) VALUES(p_worksite,encode(sha256(convert_to(btrim(p_key),'UTF8')),'hex'),p_data,auth.uid(),actor_name) RETURNING * INTO saved;
 ELSE
 SELECT * INTO old FROM public.continuous_activities WHERE id=p_id AND worksite_id=p_worksite FOR UPDATE;
 IF NOT FOUND OR old.version<>p_version THEN RAISE EXCEPTION 'Registro alterado por outra pessoa. Atualize antes de salvar.' USING ERRCODE='PT409'; END IF;
 UPDATE public.continuous_activities SET data=p_data,version=version+1,updated_at=now(),updated_by=auth.uid(),updated_by_name=actor_name WHERE id=old.id RETURNING * INTO saved;
 END IF;
 INSERT INTO public.continuous_activity_history(record_id,worksite_id,kind,previous_data,new_data,actor,actor_name) VALUES(saved.id,p_worksite,CASE WHEN p_id IS NULL THEN 'created' ELSE 'updated' END,old.data,saved.data,auth.uid(),actor_name);
 RETURN jsonb_build_object('id',saved.id,'version',saved.version);
END $function$
;

CREATE OR REPLACE FUNCTION public.save_weekly_rs_availability(p_week_id uuid, p_rows jsonb, p_expected_version integer DEFAULT 0, p_source_file_name text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    IF public.rs_program_center(item->>'center')='SERVIARI' AND upper(btrim(item->>'local'))<>'IARI' THEN
      RAISE EXCEPTION 'O centro SERVIARI pertence sempre a IARI.';
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
  IF NOT FOUND THEN RAISE EXCEPTION 'A disponibilidade foi alterada por outra pessoa. Atualize antes de salvar.' USING ERRCODE='PT409'; END IF;
  INSERT INTO public.weekly_rs_availability_history(week_id,worksite_id,version,rows,source_file_name,updated_by,updated_at)
    VALUES(saved.week_id,saved.worksite_id,saved.version,saved.rows,saved.source_file_name,saved.updated_by,saved.updated_at);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.save_weekly_rs_program_base(p_week_id uuid, p_rows jsonb, p_source_file_name text, p_sheet_name text DEFAULT 'Programação SAP'::text, p_expected_version integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
 IF coalesce(old.version,0)<>p_expected_version THEN RAISE EXCEPTION 'A base oficial foi alterada por outra pessoa. Atualize antes de importar.' USING ERRCODE='PT409'; END IF;
 SELECT coalesce(full_name,'Usuário') INTO actor FROM public.profiles WHERE id=auth.uid();
 INSERT INTO public.weekly_rs_program_bases(week_id,worksite_id,rows,version,source_file_name,sheet_name,row_count,total_work,updated_by,updated_by_name)
 VALUES(w.id,w.worksite_id,normalized,p_expected_version+1,btrim(p_source_file_name),btrim(p_sheet_name),jsonb_array_length(normalized),(SELECT sum((r->>'work')::numeric) FROM jsonb_array_elements(normalized) r),auth.uid(),coalesce(actor,'Usuário'))
 ON CONFLICT(week_id) DO UPDATE SET rows=EXCLUDED.rows,version=EXCLUDED.version,source_file_name=EXCLUDED.source_file_name,sheet_name=EXCLUDED.sheet_name,row_count=EXCLUDED.row_count,total_work=EXCLUDED.total_work,updated_at=now(),updated_by=EXCLUDED.updated_by,updated_by_name=EXCLUDED.updated_by_name RETURNING * INTO saved;
 INSERT INTO public.weekly_rs_program_base_history SELECT saved.*;
 RETURN to_jsonb(saved)-'rows';
END $function$
;
