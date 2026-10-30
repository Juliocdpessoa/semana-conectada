-- LIBRA uses the existing planning_data field, optimistic versioning and one natural history event.
-- No activity is updated or backfilled by this migration.
CREATE OR REPLACE FUNCTION public.bulk_update_activity_planning_fields(p_rows jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  affected integer;
  is_full_access boolean;
  is_operation boolean;
BEGIN
  is_full_access := auth.uid() IS NOT NULL AND (
    public.has_role(auth.uid(), 'planning') OR public.has_role(auth.uid(), 'admin')
  );
  is_operation := auth.uid() IS NOT NULL AND public.has_role(auth.uid(), 'operation');
  IF NOT is_full_access AND NOT is_operation THEN
    RAISE EXCEPTION 'Apenas Planejamento, Administrador ou Operacao pode editar estes campos.';
  END IF;
  IF coalesce(jsonb_array_length(p_rows), 0) = 0 OR jsonb_array_length(p_rows) > 500 THEN
    RAISE EXCEPTION 'Selecione entre 1 e 500 atividades.';
  END IF;
  IF is_operation AND NOT is_full_access AND jsonb_array_length(p_rows) <> 1 THEN
    RAISE EXCEPTION 'O perfil Operacao pode alterar o numero e a cor de uma PT por vez.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_rows) r
    WHERE r ? 'libra' AND (jsonb_typeof(r->'libra') NOT IN ('string','null')
      OR length(coalesce(r->>'libra',''))>120)
  ) THEN RAISE EXCEPTION 'LIBRA deve ter até 120 caracteres.'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_rows) r JOIN public.activities a ON a.id=(r->>'id')::uuid
    WHERE NOT coalesce(public.can_access_worksite(auth.uid(),a.worksite_id),false)
  ) THEN RAISE EXCEPTION 'Sem acesso à obra da atividade.'; END IF;
  IF NOT is_full_access AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_rows) r JOIN public.activities a ON a.id=(r->>'id')::uuid
    WHERE r ? 'libra' AND nullif(btrim(r->>'libra'),'') IS DISTINCT FROM nullif(btrim(a.planning_data->>'LIBRA'),'')
  ) THEN RAISE EXCEPTION 'Somente Planejamento e Administrador podem editar LIBRA.'; END IF;
  PERFORM 1 FROM public.activities a
  JOIN jsonb_to_recordset(p_rows) AS x(id uuid, expected_version integer) ON x.id = a.id
  ORDER BY a.id FOR UPDATE OF a;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_rows) AS x(id uuid, expected_version integer)
    LEFT JOIN public.activities a ON a.id = x.id
    WHERE a.id IS NULL OR a.version IS DISTINCT FROM x.expected_version
  ) THEN
    RAISE EXCEPTION 'Uma ou mais atividades foram alteradas por outro usuario. Recarregue a lista e tente novamente.';
  END IF;
  IF is_operation AND NOT is_full_access THEN
    IF EXISTS (
      SELECT 1 FROM jsonb_to_recordset(p_rows) AS x(
        id uuid, expected_version integer, pbs text, pt_number text,
        pt_color text, release_type text, scheduled_date text
      )
      JOIN public.activities a ON a.id = x.id
      WHERE nullif(btrim(x.pbs), '') IS DISTINCT FROM a.pbs
         OR nullif(btrim(x.release_type), '') IS DISTINCT FROM a.release_type
         OR nullif(btrim(x.scheduled_date), '')::date IS DISTINCT FROM a.scheduled_date
    ) THEN
      RAISE EXCEPTION 'O perfil Operacao pode alterar somente o numero e a cor da PT.';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_to_recordset(p_rows) AS x(id uuid, pt_color text)
      JOIN public.activities a ON a.id = x.id
      WHERE a.release_type IN ('ATRE', 'OFICINAS')
        AND nullif(btrim(x.pt_color), '') IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'Este tipo de liberacao nao possui cor de PT.';
    END IF;
    UPDATE public.activities a
    SET pt_number = nullif(btrim(x.pt_number), ''),
        pt_color = nullif(btrim(x.pt_color), '')
    FROM jsonb_to_recordset(p_rows) AS x(id uuid, pt_number text, pt_color text)
    WHERE a.id = x.id;
    GET DIAGNOSTICS affected = ROW_COUNT;
    RETURN affected;
  END IF;
  UPDATE public.activities a
  SET pbs = nullif(btrim(x.pbs), ''),
      pt_number = nullif(btrim(x.pt_number), ''),
      pt_color = nullif(btrim(x.pt_color), ''),
      release_type = nullif(btrim(x.release_type), ''),
      scheduled_date = nullif(btrim(x.scheduled_date), '')::date,
      planning_data = CASE
        WHEN nullif(btrim(x.scheduled_date), '') IS NULL
          THEN coalesce(a.planning_data, '{}'::jsonb) - 'Data início'
        ELSE jsonb_set(coalesce(a.planning_data, '{}'::jsonb), '{Data início}', to_jsonb(nullif(btrim(x.scheduled_date), '')), true)
      END || CASE WHEN EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_rows) r WHERE (r->>'id')::uuid=a.id AND r ? 'libra'
      ) THEN jsonb_build_object('LIBRA',nullif(btrim(x.libra),''))
        ELSE '{}'::jsonb END
  FROM jsonb_to_recordset(p_rows) AS x(
    id uuid, expected_version integer, pbs text, pt_number text,
    pt_color text, release_type text, scheduled_date text, libra text
  )
  WHERE a.id = x.id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.tg_activities_before_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ DECLARE is_leader_only boolean; planning_user boolean; operation_user boolean; report_changed boolean; responsibility_changed boolean; old_business jsonb; new_business jsonb; BEGIN planning_user := auth.uid() IS NOT NULL AND (public.has_role(auth.uid(),'planning') OR public.has_role(auth.uid(),'admin')); operation_user := auth.uid() IS NOT NULL AND public.has_role(auth.uid(),'operation'); is_leader_only := auth.uid() IS NOT NULL AND NOT (public.has_role(auth.uid(),'planning') OR public.has_role(auth.uid(),'admin')); IF NEW.status IN ('AGUARDANDO PRÉ-EMISSÃO DE PT','PT EM ASSINATURA','PT PRÉ-EMITIDA','PT ENVIADA P/ CAMPO') AND NOT planning_user AND NOT (operation_user AND NEW.status IN ('PT EM ASSINATURA','PT PRÉ-EMITIDA')) AND OLD.status IS DISTINCT FROM NEW.status THEN RAISE EXCEPTION 'Somente o perfil Planejamento pode atribuir este status.'; END IF; IF NEW.status='CANCELADA' THEN IF NOT planning_user AND (OLD.status IS DISTINCT FROM 'CANCELADA' OR OLD.justification IS DISTINCT FROM NEW.justification) THEN RAISE EXCEPTION 'Somente o perfil Planejamento pode cancelar atividades.'; END IF; IF NEW.justification NOT IN ('11 - MUDANÇA DE ESCOPO DA INTERVENÇÃO','12 - SERVIÇO CANCELADO','15 - PROGRAMAÇÃO INDEVIDA','17 - TAREFA ELIMINADA EQUIVOCADAMENTE DO SAP','22 - ATIVIDADE EXECUTADA ANTERIORMENTE','29 - OUTROS TIPOS DE PENDENCIAS') THEN RAISE EXCEPTION 'Selecione uma justificativa de cancelamento válida.'; END IF; END IF; IF NEW.status IN ('NÃO EXECUTADO','CANCELADA') THEN NEW.justification:=nullif(btrim(NEW.justification),''); IF NEW.justification IS NULL THEN RAISE EXCEPTION 'Justificativa é obrigatória para este status.'; END IF; ELSIF operation_user AND NEW.status IN ('PT EM ASSINATURA','PT PRÉ-EMITIDA') THEN NEW.justification:=OLD.justification; NEW.observation:=OLD.observation; ELSE NEW.justification:=NULL; END IF; report_changed := OLD.status IS DISTINCT FROM NEW.status OR OLD.justification IS DISTINCT FROM NEW.justification OR OLD.observation IS DISTINCT FROM NEW.observation; IF auth.uid() IS NOT NULL AND NOT planning_user THEN NEW.pbs:=OLD.pbs; IF NOT operation_user THEN NEW.pt_number:=OLD.pt_number; END IF; NEW.release_type:=OLD.release_type; NEW.d1_date:=OLD.d1_date; END IF; IF is_leader_only THEN NEW.week_id:=OLD.week_id; NEW.source_row_number:=OLD.source_row_number; NEW.source_key:=OLD.source_key; NEW.order_number:=OLD.order_number; NEW.note_number:=OLD.note_number; NEW.description:=OLD.description; NEW.area:=OLD.area; NEW.specialty:=OLD.specialty; NEW.scheduled_date:=OLD.scheduled_date; IF (coalesce(NEW.planning_data,'{}'::jsonb)-'__linked_immediate_ids') IS DISTINCT FROM (coalesce(OLD.planning_data,'{}'::jsonb)-'__linked_immediate_ids') THEN NEW.planning_data:=OLD.planning_data; END IF; NEW.is_immediate:=OLD.is_immediate; NEW.created_by:=OLD.created_by; NEW.created_at:=OLD.created_at; NEW.sync_status:=OLD.sync_status; NEW.sync_error:=OLD.sync_error; END IF; old_business:=to_jsonb(OLD)-ARRAY['id','week_id','source_row_number','source_key','planning_data','reported_by_user_id','reported_by_name','reported_by_email','reported_at','created_by','sync_status','sync_error','version','created_at','updated_at']||jsonb_build_object('libra',nullif(btrim(OLD.planning_data->>'LIBRA'),'')); new_business:=to_jsonb(NEW)-ARRAY['id','week_id','source_row_number','source_key','planning_data','reported_by_user_id','reported_by_name','reported_by_email','reported_at','created_by','sync_status','sync_error','version','created_at','updated_at']||jsonb_build_object('libra',nullif(btrim(NEW.planning_data->>'LIBRA'),'')); responsibility_changed:=report_changed OR (planning_user AND old_business IS DISTINCT FROM new_business); IF auth.uid() IS NOT NULL AND responsibility_changed THEN NEW.reported_by_user_id:=auth.uid(); SELECT p.full_name,p.email INTO NEW.reported_by_name,NEW.reported_by_email FROM public.profiles p WHERE p.id=auth.uid(); NEW.reported_at:=now(); ELSIF auth.uid() IS NOT NULL THEN NEW.reported_by_user_id:=OLD.reported_by_user_id; NEW.reported_by_name:=OLD.reported_by_name; NEW.reported_by_email:=OLD.reported_by_email; NEW.reported_at:=OLD.reported_at; END IF; NEW.updated_at:=now(); NEW.version:=OLD.version+1; RETURN NEW; END; $function$
;
CREATE OR REPLACE FUNCTION public.tg_activities_after_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ DECLARE prof record; old_business jsonb; new_business jsonb; planning_user boolean; operation_user boolean; report_changed boolean; pt_fields_changed boolean; BEGIN planning_user:=auth.uid() IS NOT NULL AND (public.has_role(auth.uid(),'planning') OR public.has_role(auth.uid(),'admin')); operation_user:=auth.uid() IS NOT NULL AND public.has_role(auth.uid(),'operation'); old_business:=to_jsonb(OLD)-ARRAY['id','week_id','source_row_number','source_key','planning_data','reported_by_user_id','reported_by_name','reported_by_email','reported_at','created_by','sync_status','sync_error','version','created_at','updated_at']||jsonb_build_object('libra',nullif(btrim(OLD.planning_data->>'LIBRA'),'')); new_business:=to_jsonb(NEW)-ARRAY['id','week_id','source_row_number','source_key','planning_data','reported_by_user_id','reported_by_name','reported_by_email','reported_at','created_by','sync_status','sync_error','version','created_at','updated_at']||jsonb_build_object('libra',nullif(btrim(NEW.planning_data->>'LIBRA'),'')); report_changed:=OLD.status IS DISTINCT FROM NEW.status OR OLD.justification IS DISTINCT FROM NEW.justification OR OLD.observation IS DISTINCT FROM NEW.observation; pt_fields_changed:=OLD.pt_number IS DISTINCT FROM NEW.pt_number OR OLD.pt_color IS DISTINCT FROM NEW.pt_color; IF (planning_user AND old_business IS DISTINCT FROM new_business) OR (operation_user AND pt_fields_changed) OR report_changed THEN SELECT full_name,email INTO prof FROM public.profiles WHERE id=auth.uid(); INSERT INTO public.activity_history(activity_id,week_id,previous_values,new_values,changed_by_user_id,changed_by_name,changed_by_email,change_source) VALUES (NEW.id,NEW.week_id,old_business,new_business,auth.uid(),coalesce(prof.full_name,''),coalesce(prof.email,''),(CASE WHEN planning_user THEN 'planning' WHEN operation_user AND pt_fields_changed THEN 'operation' ELSE 'individual' END)::public.change_source); END IF; RETURN NEW; END; $function$
;
NOTIFY pgrst,'reload schema';
