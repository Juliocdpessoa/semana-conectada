CREATE OR REPLACE FUNCTION public.patch_activity_planning_fields(p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
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
   RAISE EXCEPTION 'A tarefa recebeu atualizações. Atualize a lista e confira o campo antes de salvar.' USING ERRCODE='40001'; END IF;
  actual:=to_jsonb(a)||jsonb_build_object('libra',a.planning_data->>'LIBRA');
  FOR k IN SELECT jsonb_array_elements_text(r->'fields') LOOP
   IF k NOT IN ('pbs','pt_number','pt_color','release_type','libra','scheduled_date')
   OR NOT (r ? k) OR NOT ((r->'expected_values') ? k) THEN RAISE EXCEPTION 'Campos de edição inválidos'; END IF;
   IF NOT full_access AND k NOT IN ('pt_number','pt_color','libra') THEN RAISE EXCEPTION 'Operação pode alterar somente número, cor da PT e LIBRA'; END IF;
   IF jsonb_typeof(r->k) NOT IN ('string','null') OR length(coalesce(r->>k,''))>120 THEN RAISE EXCEPTION 'Valor inválido'; END IF;
   before_value:=nullif(btrim(actual->>k),''); next_value:=nullif(btrim(r->>k),'');
   IF before_value IS DISTINCT FROM nullif(btrim(r->'expected_values'->>k),'') THEN
    RAISE EXCEPTION 'Este campo foi atualizado. Recarregue a lista antes de editar.' USING ERRCODE='40001'; END IF;
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
END $function$;
REVOKE ALL ON FUNCTION public.patch_activity_planning_fields(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.patch_activity_planning_fields(jsonb) TO authenticated;
CREATE OR REPLACE FUNCTION public.bulk_update_activity_planning_fields(p_rows jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN RETURN (public.patch_activity_planning_fields(p_rows)->>'count')::integer; END $$;
