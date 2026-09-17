-- A confirmação SAP pode se repetir em dias diferentes. Uma apropriação só é
-- considerada programada quando a mesma confirmação existe na programação em
-- um dia coberto pelo período real informado pelo SAP.
CREATE OR REPLACE FUNCTION public.get_sap_outside_schedule(p_week_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
WITH selected_week AS (
  SELECT w.id, w.worksite_id
  FROM public.weeks w
  WHERE w.id = p_week_id
    AND public.can_access_sap(auth.uid())
    AND public.can_access_worksite(auth.uid(), w.worksite_id)
), latest_import AS (
  SELECT i.id
  FROM public.sap_confirmation_imports i
  JOIN selected_week w ON w.id = i.week_id AND w.worksite_id = i.worksite_id
  WHERE EXISTS (SELECT 1 FROM public.sap_confirmation_rows r WHERE r.import_id = i.id)
  ORDER BY i.imported_at DESC, i.id DESC
  LIMIT 1
), programmed_activities AS (
  SELECT
    btrim(coalesce(a.planning_data->>'Confirmação', a.planning_data->>'Confirmacao', '')) AS confirmation,
    a.scheduled_date
  FROM public.activities a
  JOIN selected_week w ON w.id = a.week_id AND w.worksite_id = a.worksite_id
  WHERE nullif(btrim(
    coalesce(a.planning_data->>'Confirmação', a.planning_data->>'Confirmacao', '')
  ), '') IS NOT NULL
), outside_schedule AS (
  SELECT
    s.id,
    s.order_number,
    s.operation,
    s.suboperation,
    s.description,
    s.actual_start_date,
    s.actual_end_date,
    s.actual_work,
    s.confirmation,
    s.planning_code,
    CASE
      WHEN nullif(
        regexp_replace(
          regexp_replace(btrim(coalesce(s.planning_code, '')), '([,.]0+)$', '', 'g'),
          '^0+', ''
        ),
        ''
      ) = '2' THEN 'IMEDIATA'
      ELSE 'NÃO PROGRAMADA'
    END AS classification
  FROM public.sap_confirmation_rows s
  WHERE s.import_id = (SELECT id FROM latest_import)
    AND s.has_confirmation
    AND coalesce(s.actual_work, 0) > 0
    AND nullif(
      regexp_replace(
        regexp_replace(btrim(coalesce(s.planning_code, '')), '([,.]0+)$', '', 'g'),
        '^0+', ''
      ),
      ''
    ) IN ('1', '2')
    AND NOT EXISTS (
      SELECT 1
      FROM programmed_activities p
      WHERE p.confirmation = btrim(coalesce(s.confirmation, ''))
        AND p.scheduled_date BETWEEN
          coalesce(s.actual_start_date, s.actual_end_date, p.scheduled_date)
          AND coalesce(s.actual_end_date, s.actual_start_date, p.scheduled_date)
    )
)
SELECT jsonb_build_object(
  'unprogrammedCount', count(*) FILTER (WHERE classification = 'NÃO PROGRAMADA'),
  'immediateCount', count(*) FILTER (WHERE classification = 'IMEDIATA'),
  'rows', coalesce(
    jsonb_agg(to_jsonb(o) ORDER BY o.actual_end_date, o.order_number, o.operation),
    '[]'::jsonb
  )
)
FROM outside_schedule o;
$$;

REVOKE ALL ON FUNCTION public.get_sap_outside_schedule(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sap_outside_schedule(uuid) TO authenticated;
