-- Importação atômica das confirmações SAP pela tela de Atividades.
-- Cada carga é preservada; a mais recente é usada no comparativo.
CREATE OR REPLACE FUNCTION public.import_sap_confirmations(
  p_week_id uuid,
  p_source_file_name text,
  p_rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_week public.weeks%ROWTYPE;
  new_import_id uuid;
  imported_count integer;
BEGIN
  IF NOT public.is_approved(auth.uid())
    OR NOT (public.has_role(auth.uid(), 'planning') OR public.has_role(auth.uid(), 'admin')) THEN
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
    worksite_id, week_id, source_file_name, source_label, row_count, imported_by
  ) VALUES (
    target_week.worksite_id,
    target_week.id,
    left(btrim(p_source_file_name), 240),
    'Importação pela tela de Atividades',
    jsonb_array_length(p_rows),
    auth.uid()
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
$$;

REVOKE ALL ON FUNCTION public.import_sap_confirmations(uuid,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_sap_confirmations(uuid,text,jsonb) TO authenticated;
