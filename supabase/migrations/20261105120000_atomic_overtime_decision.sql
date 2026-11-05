-- Decide pending members atomically; each row retains its own version counter.
CREATE OR REPLACE FUNCTION public.decide_overtime_batch(
 p_request_id uuid,p_expected_version integer,p_snapshot jsonb,p_decision text,p_comment text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
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
 IF changed_count<>pending_count THEN RAISE EXCEPTION 'O lote foi alterado; nenhuma decisão foi salva.' USING ERRCODE='40001'; END IF;
 RETURN jsonb_build_object('ok',true,'count',changed_count,'updated',changed);
END $$;
REVOKE ALL ON FUNCTION public.decide_overtime_batch(uuid,integer,jsonb,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.decide_overtime_batch(uuid,integer,jsonb,text,text) TO authenticated;
