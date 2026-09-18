CREATE OR REPLACE FUNCTION public.tg_activities_before_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  is_leader_only boolean;
  planning_user boolean;
  operation_user boolean;
  report_changed boolean;
  responsibility_changed boolean;
  old_business jsonb;
  new_business jsonb;
BEGIN
  planning_user := auth.uid() IS NOT NULL AND (public.has_role(auth.uid(), 'planning') OR public.has_role(auth.uid(), 'admin'));
  operation_user := auth.uid() IS NOT NULL AND public.has_role(auth.uid(), 'operation');
  is_leader_only := auth.uid() IS NOT NULL AND NOT (
    public.has_role(auth.uid(), 'planning') OR public.has_role(auth.uid(), 'admin')
  );

  IF NEW.status IN ('AGUARDANDO PRÉ-EMISSÃO DE PT', 'PT EM ASSINATURA', 'PT PRÉ-EMITIDA', 'PT ENVIADA P/ CAMPO')
     AND NOT planning_user
     AND NOT (operation_user AND NEW.status IN ('PT EM ASSINATURA', 'PT PRÉ-EMITIDA'))
     AND OLD.status IS DISTINCT FROM NEW.status THEN
    RAISE EXCEPTION 'Somente o perfil Planejamento pode atribuir este status.';
  END IF;

  IF NEW.status = 'CANCELADA' THEN
    IF NOT planning_user
       AND (OLD.status IS DISTINCT FROM 'CANCELADA' OR OLD.justification IS DISTINCT FROM NEW.justification) THEN
      RAISE EXCEPTION 'Somente o perfil Planejamento pode cancelar atividades.';
    END IF;
    IF NEW.justification NOT IN (
      '11 - MUDANÇA DE ESCOPO DA INTERVENÇÃO',
      '12 - SERVIÇO CANCELADO',
      '15 - PROGRAMAÇÃO INDEVIDA',
      '17 - TAREFA ELIMINADA EQUIVOCADAMENTE DO SAP',
      '22 - ATIVIDADE EXECUTADA ANTERIORMENTE',
      '29 - OUTROS TIPOS DE PENDENCIAS'
    ) THEN
      RAISE EXCEPTION 'Selecione uma justificativa de cancelamento válida.';
    END IF;
  END IF;

  IF NEW.status IN ('NÃO EXECUTADO', 'CANCELADA') THEN
    NEW.justification := nullif(btrim(NEW.justification), '');
    IF NEW.justification IS NULL THEN
      RAISE EXCEPTION 'Justificativa é obrigatória para este status.';
    END IF;
  ELSIF operation_user AND NEW.status IN ('PT EM ASSINATURA', 'PT PRÉ-EMITIDA') THEN
    NEW.justification := OLD.justification;
    NEW.observation := OLD.observation;
  ELSE
    NEW.justification := NULL;
  END IF;

  report_changed :=
       OLD.status IS DISTINCT FROM NEW.status
    OR OLD.justification IS DISTINCT FROM NEW.justification
    OR OLD.observation IS DISTINCT FROM NEW.observation;

  IF auth.uid() IS NOT NULL AND NOT planning_user THEN
    NEW.pbs := OLD.pbs;
    NEW.pt_number := OLD.pt_number;
    NEW.release_type := OLD.release_type;
    NEW.d1_date := OLD.d1_date;
  END IF;

  IF is_leader_only THEN
    NEW.week_id := OLD.week_id;
    NEW.source_row_number := OLD.source_row_number;
    NEW.source_key := OLD.source_key;
    NEW.order_number := OLD.order_number;
    NEW.note_number := OLD.note_number;
    NEW.description := OLD.description;
    NEW.area := OLD.area;
    NEW.specialty := OLD.specialty;
    NEW.scheduled_date := OLD.scheduled_date;
    IF (coalesce(NEW.planning_data, '{}'::jsonb) - '__linked_immediate_ids')
       IS DISTINCT FROM
       (coalesce(OLD.planning_data, '{}'::jsonb) - '__linked_immediate_ids') THEN
      NEW.planning_data := OLD.planning_data;
    END IF;
    NEW.is_immediate := OLD.is_immediate;
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
    NEW.sync_status := OLD.sync_status;
    NEW.sync_error := OLD.sync_error;
  END IF;

  old_business := to_jsonb(OLD) - ARRAY[
    'id', 'week_id', 'source_row_number', 'source_key', 'planning_data',
    'reported_by_user_id', 'reported_by_name', 'reported_by_email', 'reported_at',
    'created_by', 'sync_status', 'sync_error', 'version', 'created_at', 'updated_at'
  ];
  new_business := to_jsonb(NEW) - ARRAY[
    'id', 'week_id', 'source_row_number', 'source_key', 'planning_data',
    'reported_by_user_id', 'reported_by_name', 'reported_by_email', 'reported_at',
    'created_by', 'sync_status', 'sync_error', 'version', 'created_at', 'updated_at'
  ];
  responsibility_changed := report_changed OR (planning_user AND old_business IS DISTINCT FROM new_business);

  IF auth.uid() IS NOT NULL AND responsibility_changed THEN
    NEW.reported_by_user_id := auth.uid();
    SELECT p.full_name, p.email
      INTO NEW.reported_by_name, NEW.reported_by_email
      FROM public.profiles p
     WHERE p.id = auth.uid();
    NEW.reported_at := now();
  ELSIF auth.uid() IS NOT NULL THEN
    NEW.reported_by_user_id := OLD.reported_by_user_id;
    NEW.reported_by_name := OLD.reported_by_name;
    NEW.reported_by_email := OLD.reported_by_email;
    NEW.reported_at := OLD.reported_at;
  END IF;

  NEW.updated_at := now();
  NEW.version := OLD.version + 1;
  RETURN NEW;
END;
$function$;