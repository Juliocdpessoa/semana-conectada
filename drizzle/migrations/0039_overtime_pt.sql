ALTER TABLE public.overtime_requests ADD COLUMN IF NOT EXISTS pt_number text;
ALTER TABLE public.overtime_requests ADD COLUMN IF NOT EXISTS pt_updated_at timestamptz;
ALTER TABLE public.overtime_requests ADD COLUMN IF NOT EXISTS pt_updated_by uuid;
ALTER TABLE public.overtime_requests ADD COLUMN IF NOT EXISTS pt_updated_by_name text;
ALTER TABLE public.overtime_requests ADD CONSTRAINT overtime_pt_length CHECK(pt_number IS NULL OR length(pt_number)<=120);
CREATE TABLE public.overtime_pt_history(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),request_id uuid NOT NULL,worksite_id uuid NOT NULL,
 previous_pt text,new_pt text,changed_by uuid,changed_by_name text,changed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.overtime_pt_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.overtime_pt_history FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.overtime_pt_history TO authenticated,service_role;
CREATE POLICY overtime_pt_history_read ON public.overtime_pt_history FOR SELECT TO authenticated USING(
 public.can_access_worksite(auth.uid(),worksite_id) AND (
 changed_by=auth.uid() OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager') OR public.has_role(auth.uid(),'measurement_control')));
CREATE OR REPLACE FUNCTION public.audit_overtime_pt() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor uuid; actor_name text; previous text;
BEGIN
 IF TG_OP='UPDATE' THEN previous:=OLD.pt_number; END IF;
 IF NEW.pt_number IS NOT DISTINCT FROM previous THEN RETURN NEW; END IF;
 actor:=coalesce(auth.uid(),NEW.pt_updated_by,NEW.requester_user_id);
 SELECT full_name INTO actor_name FROM public.profiles WHERE id=actor;
 NEW.pt_updated_at:=now(); NEW.pt_updated_by:=actor; NEW.pt_updated_by_name:=actor_name;
 INSERT INTO public.overtime_pt_history(request_id,worksite_id,previous_pt,new_pt,changed_by,changed_by_name)
 VALUES(NEW.id,NEW.worksite_id,previous,NEW.pt_number,actor,actor_name);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.audit_overtime_pt() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER overtime_pt_audit BEFORE INSERT OR UPDATE OF pt_number ON public.overtime_requests FOR EACH ROW EXECUTE FUNCTION public.audit_overtime_pt();
CREATE OR REPLACE FUNCTION public.complete_overtime_pt(p_id uuid,p_expected_version integer,p_pt text,p_apply_batch boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor uuid:=auth.uid(); target public.overtime_requests%ROWTYPE; r public.overtime_requests%ROWTYPE;
 ids uuid[]:='{}'; value text:=btrim(p_pt); changed int;
BEGIN
 IF NOT coalesce(public.is_approved(actor),false) THEN RETURN jsonb_build_object('ok',false,'error','Usuário não aprovado.'); END IF;
 IF value IS NULL OR value='' OR length(value)>120 THEN RETURN jsonb_build_object('ok',false,'error','Informe o Nº PT (até 120 caracteres). Se for oficina, preencha NA.'); END IF;
 IF upper(value)='NA' THEN value:='NA'; END IF;
 SELECT * INTO target FROM public.overtime_requests WHERE id=p_id AND requester_user_id=actor;
 IF NOT FOUND OR NOT coalesce(public.can_access_worksite(actor,target.worksite_id),false) OR target.source_type<>'manual' THEN RETURN jsonb_build_object('ok',false,'error','Só é possível informar PT nas próprias solicitações manuais.'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('overtime-pt:'||coalesce(target.batch_id,target.id)::text,0));
 FOR r IN SELECT * FROM public.overtime_requests x WHERE x.worksite_id=target.worksite_id AND x.requester_user_id=actor
 AND ((coalesce(p_apply_batch,false) AND target.batch_id IS NOT NULL AND x.batch_id=target.batch_id) OR x.id=p_id)
 ORDER BY x.id FOR UPDATE LOOP
 IF r.id=p_id THEN target:=r; END IF;
 IF r.source_type='manual' AND r.status IN ('pending','approved') AND nullif(btrim(r.pt_number),'') IS NULL THEN ids:=array_append(ids,r.id); END IF;
 END LOOP;
 IF target.status NOT IN ('pending','approved') OR nullif(btrim(target.pt_number),'') IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'error','Este registro já tem PT ou não permite complemento. Atualize a lista.'); END IF;
 IF p_expected_version IS NULL OR target.version<>p_expected_version OR NOT p_id=ANY(ids) THEN RETURN jsonb_build_object('ok',false,'conflict',true,'error','A solicitação foi alterada. Atualize a lista antes de informar a PT.'); END IF;
 UPDATE public.overtime_requests SET pt_number=value,version=version+1 WHERE id=ANY(ids);
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>array_length(ids,1) THEN RAISE EXCEPTION 'Conflito ao salvar PT'; END IF;
 RETURN jsonb_build_object('ok',true,'count',changed);
END $$;
REVOKE ALL ON FUNCTION public.complete_overtime_pt(uuid,integer,text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.complete_overtime_pt(uuid,integer,text,boolean) TO authenticated;
