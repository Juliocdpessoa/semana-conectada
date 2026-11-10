CREATE OR REPLACE FUNCTION public.complete_overtime_pt(p_id uuid, p_expected_version integer, p_pt text, p_apply_batch boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE actor uuid:=auth.uid(); target public.overtime_requests%ROWTYPE; r public.overtime_requests%ROWTYPE;
 ids uuid[]:='{}'; value text:=btrim(p_pt); changed int;
BEGIN
 IF NOT coalesce(public.is_approved(actor),false) THEN RETURN jsonb_build_object('ok',false,'error','Usuário não aprovado.'); END IF;
 IF value IS NULL OR value='' OR length(value)>120 THEN RETURN jsonb_build_object('ok',false,'error','Informe o Nº PT (até 120 caracteres). Se for oficina, preencha NA.'); END IF;
 IF upper(value)='NA' THEN value:='NA'; END IF;
 SELECT * INTO target FROM public.overtime_requests WHERE id=p_id AND requester_user_id=actor;
 IF NOT FOUND OR NOT coalesce(public.can_access_worksite(actor,target.worksite_id),false) OR target.source_type NOT IN ('manual','scale_change') THEN RETURN jsonb_build_object('ok',false,'error','Só é possível informar PT nas próprias solicitações de hora extra.'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('overtime-pt:'||coalesce(target.batch_id,target.id)::text,0));
 FOR r IN SELECT * FROM public.overtime_requests x WHERE x.worksite_id=target.worksite_id AND x.requester_user_id=actor
 AND ((coalesce(p_apply_batch,false) AND target.batch_id IS NOT NULL AND x.batch_id=target.batch_id) OR x.id=p_id)
 ORDER BY x.id FOR UPDATE LOOP
 IF r.id=p_id THEN target:=r; END IF;
 IF r.source_type IN ('manual','scale_change') AND r.source_type=target.source_type AND r.status IN ('pending','approved') AND nullif(btrim(r.pt_number),'') IS NULL THEN ids:=array_append(ids,r.id); END IF;
 END LOOP;
 IF target.status NOT IN ('pending','approved') OR nullif(btrim(target.pt_number),'') IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'error','Este registro já tem PT ou não permite complemento. Atualize a lista.'); END IF;
 IF p_expected_version IS NULL OR target.version<>p_expected_version OR NOT p_id=ANY(ids) THEN RETURN jsonb_build_object('ok',false,'conflict',true,'error','A solicitação foi alterada. Atualize a lista antes de informar a PT.'); END IF;
 UPDATE public.overtime_requests SET pt_number=value,version=version+1 WHERE id=ANY(ids);
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>array_length(ids,1) THEN RAISE EXCEPTION 'Conflito ao salvar PT'; END IF;
 RETURN jsonb_build_object('ok',true,'count',changed);
END $function$;
