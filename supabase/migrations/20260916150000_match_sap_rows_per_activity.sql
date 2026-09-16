-- Vincula cada linha SAP à tarefa correta por ordem/operação/suboperação.
-- A confirmação pode se repetir em dias ou tarefas diferentes e, por isso,
-- não pode ser usada isoladamente para consumir uma linha SAP.
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
   AND s.order_number = a.order_number
   AND nullif(regexp_replace(btrim(coalesce(s.operation, '')), '^0+', ''), '') IS NOT DISTINCT FROM a.activity_operation
   AND (
     a.activity_suboperation IS NULL
     OR nullif(regexp_replace(btrim(coalesce(s.suboperation, '')), '^0+', ''), '') IS NOT DISTINCT FROM a.activity_suboperation
   )
), classified AS (
  SELECT m.activity_id, m.sap_row_id, m.actual_work,
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
    s.planning_code,
    CASE
      WHEN nullif(regexp_replace(regexp_replace(btrim(coalesce(s.planning_code, '')), '([,.]0+)$', '', 'g'), '^0+', ''), '') = '2'
        THEN 'IMEDIATA'
      ELSE 'NÃO PROGRAMADA'
    END classification,
    'Confirmada no SAP'::text sap_status
  FROM public.sap_confirmation_rows s
  WHERE s.import_id = (SELECT id FROM latest_import)
    AND s.has_confirmation
    AND coalesce(s.actual_work, 0) > 0
    AND nullif(regexp_replace(regexp_replace(btrim(coalesce(s.planning_code, '')), '([,.]0+)$', '', 'g'), '^0+', ''), '') IN ('1', '2')
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
  'hours', coalesce((SELECT jsonb_object_agg(activity_id, actual_work) FROM classified WHERE sap_row_id IS NOT NULL), '{}'::jsonb),
  'counts', coalesce((SELECT jsonb_object_agg(sap_status, total) FROM counts), '{}'::jsonb),
  'unprogrammedCount', (SELECT count(*) FROM unprogrammed WHERE classification = 'NÃO PROGRAMADA'),
  'immediateCount', (SELECT count(*) FROM unprogrammed WHERE classification = 'IMEDIATA'),
  'unprogrammed', coalesce((SELECT jsonb_agg(to_jsonb(u) ORDER BY u.actual_end_date, u.order_number, u.operation) FROM unprogrammed u), '[]'::jsonb)
)
FROM selected_week;
$$;

REVOKE ALL ON FUNCTION public.get_sap_confirmation_overview(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sap_confirmation_overview(uuid) TO authenticated;
