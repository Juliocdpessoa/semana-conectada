CREATE OR REPLACE FUNCTION public.bulk_update_activity_reports(
  p_ids uuid[],
  p_status text,
  p_justification text,
  p_observation text,
  p_linked_ids uuid[] DEFAULT ARRAY[]::uuid[]
)
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_week_id uuid;
  v_selected_count integer;
  v_linked_count integer;
  v_justification text;
  v_is_operation boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Usuário não autenticado.'; END IF;

  IF p_status NOT IN (
    'Sem apontamento',
    'EXECUTADO',
    'NÃO EXECUTADO',
    'AGUARDANDO PRÉ-EMISSÃO DE PT',
    'PT EM ASSINATURA',
    'PT PRÉ-EMITIDA',
    'PT ENVIADA P/ CAMPO',
    'CANCELADA'
  ) THEN
    RAISE EXCEPTION 'Status inválido.';
  END IF;

  IF coalesce(array_length(p_ids, 1), 0) = 0 OR array_length(p_ids, 1) > 500 THEN
    RAISE EXCEPTION 'Selecione entre 1 e 500 atividades.';
  END IF;

  v_justification := CASE
    WHEN p_status IN ('NÃO EXECUTADO', 'CANCELADA') THEN nullif(btrim(p_justification), '')
    ELSE NULL
  END;

  IF p_status IN ('NÃO EXECUTADO', 'CANCELADA') AND v_justification IS NULL THEN
    RAISE EXCEPTION 'Justificativa é obrigatória.';
  END IF;

  v_is_operation := public.has_role(auth.uid(), 'operation');

  IF p_status IN (
    'AGUARDANDO PRÉ-EMISSÃO DE PT',
    'PT EM ASSINATURA',
    'PT PRÉ-EMITIDA',
    'PT ENVIADA P/ CAMPO'
  )
  AND NOT public.has_role(auth.uid(), 'planning')
  AND NOT (
    v_is_operation
    AND p_status IN ('PT EM ASSINATURA', 'PT PRÉ-EMITIDA')
  ) THEN
    RAISE EXCEPTION 'Somente o perfil Planejamento pode atribuir este status.';
  END IF;

  IF p_status = 'CANCELADA' THEN
    IF NOT public.has_role(auth.uid(), 'planning') THEN
      RAISE EXCEPTION 'Somente o perfil Planejamento pode cancelar atividades.';
    END IF;
    IF v_justification NOT IN (
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

  SELECT count(*), min(week_id::text)::uuid
    INTO v_selected_count, v_week_id
    FROM public.activities
   WHERE id = ANY(p_ids);

  IF v_selected_count <> array_length(p_ids, 1) THEN
    RAISE EXCEPTION 'Uma ou mais atividades não foram encontradas ou não estão acessíveis.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.activities WHERE id = ANY(p_ids) AND week_id <> v_week_id) THEN
    RAISE EXCEPTION 'As atividades devem pertencer à mesma semana.';
  END IF;

  IF p_status = 'NÃO EXECUTADO' AND coalesce(v_justification, '') LIKE '08 -%' THEN
    IF coalesce(array_length(p_linked_ids, 1), 0) = 0 THEN
      RAISE EXCEPTION 'Selecione ao menos uma atividade imediata atendida.';
    END IF;
    SELECT count(*) INTO v_linked_count
      FROM public.activities
     WHERE id = ANY(p_linked_ids)
       AND week_id = v_week_id
       AND is_immediate = true;
    IF v_linked_count <> array_length(p_linked_ids, 1) THEN
      RAISE EXCEPTION 'Uma ou mais atividades imediatas são inválidas.';
    END IF;
  END IF;

  UPDATE public.activities
     SET status = p_status,
         justification = v_justification,
         observation = p_observation,
         planning_data = CASE
           WHEN p_status = 'NÃO EXECUTADO' AND coalesce(v_justification, '') LIKE '08 -%'
             THEN jsonb_set(coalesce(planning_data, '{}'::jsonb), '{__linked_immediate_ids}', to_jsonb(p_linked_ids), true)
           ELSE coalesce(planning_data, '{}'::jsonb) - '__linked_immediate_ids'
         END
   WHERE id = ANY(p_ids);

  IF p_status = 'NÃO EXECUTADO' AND coalesce(v_justification, '') LIKE '08 -%' THEN
    UPDATE public.activities
       SET status = 'EXECUTADO', justification = NULL
     WHERE id = ANY(p_linked_ids)
       AND week_id = v_week_id
       AND is_immediate = true;
  END IF;

  RETURN v_selected_count;
END;
$function$;