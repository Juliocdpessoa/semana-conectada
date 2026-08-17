CREATE OR REPLACE FUNCTION public.bulk_update_activity_reports(p_ids uuid[], p_status text, p_justification text, p_observation text, p_linked_ids uuid[] DEFAULT ARRAY[]::uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_week_id uuid;
  v_selected_count integer;
  v_linked_count integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Usuário não autenticado.'; END IF;
  IF coalesce(array_length(p_ids, 1), 0) = 0 OR array_length(p_ids, 1) > 500 THEN
    RAISE EXCEPTION 'Selecione entre 1 e 500 atividades.';
  END IF;
  IF p_status = 'NÃO EXECUTADO' AND nullif(btrim(p_justification), '') IS NULL THEN
    RAISE EXCEPTION 'Justificativa é obrigatória.';
  END IF;

  SELECT count(*), min(week_id::text)::uuid INTO v_selected_count, v_week_id
    FROM public.activities WHERE id = ANY(p_ids);
  IF v_selected_count <> array_length(p_ids, 1) THEN
    RAISE EXCEPTION 'Uma ou mais atividades não foram encontradas ou não estão acessíveis.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.activities WHERE id = ANY(p_ids) AND week_id <> v_week_id) THEN
    RAISE EXCEPTION 'As atividades devem pertencer à mesma semana.';
  END IF;

  IF p_status = 'NÃO EXECUTADO' AND coalesce(p_justification, '') LIKE '08 -%' THEN
    IF coalesce(array_length(p_linked_ids, 1), 0) = 0 THEN
      RAISE EXCEPTION 'Selecione ao menos uma atividade imediata atendida.';
    END IF;
    SELECT count(*) INTO v_linked_count FROM public.activities
     WHERE id = ANY(p_linked_ids) AND week_id = v_week_id AND is_immediate = true;
    IF v_linked_count <> array_length(p_linked_ids, 1) THEN
      RAISE EXCEPTION 'Uma ou mais atividades imediatas são inválidas.';
    END IF;
  END IF;

  UPDATE public.activities
     SET status = p_status,
         justification = p_justification,
         observation = p_observation,
         planning_data = CASE
           WHEN p_status = 'NÃO EXECUTADO' AND coalesce(p_justification, '') LIKE '08 -%'
             THEN jsonb_set(coalesce(planning_data, '{}'::jsonb), '{__linked_immediate_ids}', to_jsonb(p_linked_ids), true)
           ELSE coalesce(planning_data, '{}'::jsonb) - '__linked_immediate_ids'
         END
   WHERE id = ANY(p_ids);

  IF p_status = 'NÃO EXECUTADO' AND coalesce(p_justification, '') LIKE '08 -%' THEN
    UPDATE public.activities SET status = 'EXECUTADO', justification = NULL
     WHERE id = ANY(p_linked_ids) AND week_id = v_week_id AND is_immediate = true;
  END IF;

  RETURN v_selected_count;
END;
$function$;