-- Mantém somente as linhas da carga SAP mais recente por obra, preservando
-- nas atividades o resultado consolidado das semanas anteriores.

ALTER TABLE public.activities
  ADD COLUMN IF NOT EXISTS sap_status_snapshot text,
  ADD COLUMN IF NOT EXISTS sap_status_snapshot_at timestamptz;

CREATE INDEX IF NOT EXISTS activities_week_sap_snapshot_idx
  ON public.activities (week_id, sap_status_snapshot)
  WHERE sap_status_snapshot IS NOT NULL;

CREATE OR REPLACE FUNCTION public.freeze_sap_week_statuses(p_week_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  overview jsonb;
  affected integer := 0;
BEGIN
  overview := public.get_sap_confirmation_overview(p_week_id);

  IF overview IS NULL OR NOT coalesce((overview->>'hasImport')::boolean, false) THEN
    RETURN 0;
  END IF;

  UPDATE public.activities a
  SET sap_status_snapshot = status_item.value,
      sap_status_snapshot_at = now()
  FROM jsonb_each_text(coalesce(overview->'statuses', '{}'::jsonb)) AS status_item(key, value)
  WHERE a.week_id = p_week_id
    AND a.id::text = status_item.key;

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

REVOKE ALL ON FUNCTION public.freeze_sap_week_statuses(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.freeze_sap_week_statuses(uuid) TO service_role;

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
  importer public.profiles%ROWTYPE;
  previous_week record;
  new_import_id uuid;
  imported_count integer;
BEGIN
  IF NOT public.is_approved(auth.uid()) OR NOT public.can_access_sap(auth.uid()) THEN
    RAISE EXCEPTION 'Somente Planejamento ou o administrador geral pode importar confirmações SAP.';
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

  -- Serializa substituições concorrentes dentro da mesma obra.
  PERFORM pg_advisory_xact_lock(hashtext(target_week.worksite_id::text));

  -- Consolida todas as semanas que ainda possuam linhas materializadas. Isso
  -- também preserva corretamente as cargas que já existiam antes desta regra.
  FOR previous_week IN
    SELECT DISTINCT r.week_id
    FROM public.sap_confirmation_rows r
    WHERE r.worksite_id = target_week.worksite_id
      AND r.week_id <> target_week.id
  LOOP
    PERFORM public.freeze_sap_week_statuses(previous_week.week_id);
  END LOOP;

  -- Somente a última planilha permanece materializada. Os cabeçalhos das
  -- cargas anteriores continuam disponíveis como trilha de auditoria.
  DELETE FROM public.sap_confirmation_rows
  WHERE worksite_id = target_week.worksite_id;

  -- Uma recarga da mesma semana volta a usar exclusivamente os dados novos.
  UPDATE public.activities
  SET sap_status_snapshot = NULL,
      sap_status_snapshot_at = NULL
  WHERE week_id = target_week.id
    AND worksite_id = target_week.worksite_id
    AND sap_status_snapshot IS NOT NULL;

  SELECT * INTO importer FROM public.profiles WHERE id = auth.uid();

  INSERT INTO public.sap_confirmation_imports (
    worksite_id, week_id, source_file_name, source_label, row_count, imported_by,
    imported_by_name, imported_by_email
  ) VALUES (
    target_week.worksite_id,
    target_week.id,
    left(btrim(p_source_file_name), 240),
    'Importação pela tela de Atividades',
    jsonb_array_length(p_rows),
    auth.uid(),
    nullif(btrim(importer.full_name), ''),
    nullif(btrim(importer.email), '')
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

-- O painel usa a carga materializada quando ela existe. Para semanas antigas,
-- usa o resultado congelado na própria atividade.
CREATE OR REPLACE FUNCTION public.get_sap_confirmation_overview(p_week_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
WITH selected_week AS (
  SELECT w.*,
    ((w.end_date + ((8 - extract(isodow FROM w.end_date)::integer) % 7))::date::timestamp
      + interval '12 hours') AT TIME ZONE 'America/Sao_Paulo' AS deadline
  FROM public.weeks w
  WHERE w.id = p_week_id
    AND public.can_access_sap(auth.uid())
    AND public.can_access_worksite(auth.uid(), w.worksite_id)
), latest_import AS (
  SELECT i.id, i.row_count
  FROM public.sap_confirmation_imports i
  JOIN selected_week w ON w.id = i.week_id AND w.worksite_id = i.worksite_id
  WHERE EXISTS (SELECT 1 FROM public.sap_confirmation_rows r WHERE r.import_id = i.id)
  ORDER BY i.imported_at DESC, i.id DESC
  LIMIT 1
), activity_base AS (
  SELECT a.*,
    nullif(btrim(coalesce(a.planning_data->>'Confirmação', a.planning_data->>'Confirmacao', '')), '') AS activity_confirmation,
    nullif(regexp_replace(btrim(coalesce(a.planning_data->>'Op', a.planning_data->>'Operação', '')), '^0+', ''), '') AS activity_operation,
    nullif(regexp_replace(btrim(coalesce(a.planning_data->>'Subop', a.planning_data->>'Suboperação', '')), '^0+', ''), '') AS activity_suboperation
  FROM public.activities a
  JOIN selected_week w ON w.id = a.week_id AND w.worksite_id = a.worksite_id
), matched AS (
  SELECT a.id activity_id, a.status operational_status, a.is_immediate,
    a.sap_status_snapshot, s.id sap_row_id, s.has_confirmation,
    coalesce(s.actual_work, 0) actual_work,
    row_number() OVER (
      PARTITION BY a.id
      ORDER BY
        CASE WHEN a.activity_confirmation IS NOT NULL AND s.confirmation = a.activity_confirmation THEN 0 ELSE 1 END,
        CASE WHEN a.scheduled_date = s.actual_end_date THEN 0 ELSE 1 END,
        s.source_row_number
    ) match_rank
  FROM activity_base a
  LEFT JOIN public.sap_confirmation_rows s
    ON s.import_id = (SELECT id FROM latest_import)
   AND (
     (a.activity_confirmation IS NOT NULL AND s.confirmation = a.activity_confirmation)
     OR (
       s.order_number = a.order_number
       AND nullif(regexp_replace(btrim(coalesce(s.operation, '')), '^0+', ''), '') IS NOT DISTINCT FROM a.activity_operation
       AND (
         a.activity_suboperation IS NULL
         OR nullif(regexp_replace(btrim(coalesce(s.suboperation, '')), '^0+', ''), '') IS NOT DISTINCT FROM a.activity_suboperation
       )
     )
   )
), classified AS (
  SELECT m.activity_id, m.sap_row_id,
    CASE
      WHEN NOT EXISTS (SELECT 1 FROM latest_import) THEN m.sap_status_snapshot
      WHEN m.operational_status IN ('NÃO EXECUTADO', 'CANCELADA') AND coalesce(m.has_confirmation, false) THEN 'Divergência'
      WHEN coalesce(m.has_confirmation, false) AND m.actual_work > 0 THEN 'Confirmada no SAP'
      WHEN coalesce(m.has_confirmation, false) THEN 'Confirmada sem HH'
      WHEN m.operational_status IN ('NÃO EXECUTADO', 'CANCELADA') THEN 'Confirmação não esperada'
      WHEN now() <= (SELECT deadline FROM selected_week) THEN 'Aguardando confirmação'
      ELSE 'Não confirmada no SAP'
    END sap_status
  FROM matched m
  WHERE m.match_rank = 1
    AND (EXISTS (SELECT 1 FROM latest_import) OR m.sap_status_snapshot IS NOT NULL)
), linked_sap AS (
  SELECT DISTINCT sap_row_id FROM classified WHERE sap_row_id IS NOT NULL
), unprogrammed AS (
  SELECT s.id, s.order_number, s.operation, s.suboperation, s.description,
    s.actual_start_date, s.actual_end_date, s.actual_work, s.confirmation,
    CASE
      WHEN s.has_confirmation AND coalesce(s.actual_work, 0) > 0 THEN 'Confirmada no SAP'
      WHEN s.has_confirmation THEN 'Confirmada sem HH'
      ELSE 'Não confirmada no SAP'
    END sap_status
  FROM public.sap_confirmation_rows s
  WHERE s.import_id = (SELECT id FROM latest_import)
    AND NOT EXISTS (SELECT 1 FROM linked_sap l WHERE l.sap_row_id = s.id)
), counts AS (
  SELECT sap_status, count(*)::integer total FROM classified GROUP BY sap_status
)
SELECT jsonb_build_object(
  'deadline', (SELECT deadline FROM selected_week),
  'hasImport', EXISTS (SELECT 1 FROM latest_import) OR EXISTS (SELECT 1 FROM classified),
  'isSnapshot', NOT EXISTS (SELECT 1 FROM latest_import) AND EXISTS (SELECT 1 FROM classified),
  'importedRows', coalesce((SELECT row_count FROM latest_import), (SELECT count(*) FROM classified), 0),
  'statuses', coalesce((SELECT jsonb_object_agg(activity_id, sap_status) FROM classified), '{}'::jsonb),
  'counts', coalesce((SELECT jsonb_object_agg(sap_status, total) FROM counts), '{}'::jsonb),
  'unprogrammedCount', (SELECT count(*) FROM unprogrammed),
  'unprogrammed', coalesce((SELECT jsonb_agg(to_jsonb(u) ORDER BY u.actual_end_date, u.order_number, u.operation) FROM unprogrammed u), '[]'::jsonb)
)
FROM selected_week;
$$;

REVOKE ALL ON FUNCTION public.get_sap_confirmation_overview(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sap_confirmation_overview(uuid) TO authenticated;
