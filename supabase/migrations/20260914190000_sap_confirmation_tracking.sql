-- Conferência das atividades executadas com a extração oficial do SAP.
-- O status operacional da atividade continua independente do status SAP.

CREATE TABLE public.sap_confirmation_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  worksite_id uuid NOT NULL REFERENCES public.worksites(id),
  week_id uuid NOT NULL REFERENCES public.weeks(id) ON DELETE CASCADE,
  source_file_name text NOT NULL,
  source_label text,
  row_count integer NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  imported_by uuid REFERENCES auth.users(id),
  imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.sap_confirmation_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id uuid NOT NULL REFERENCES public.sap_confirmation_imports(id) ON DELETE CASCADE,
  worksite_id uuid NOT NULL REFERENCES public.worksites(id),
  week_id uuid NOT NULL REFERENCES public.weeks(id) ON DELETE CASCADE,
  source_row_number integer NOT NULL,
  order_number text NOT NULL,
  operation text,
  suboperation text,
  planning_code text,
  work_center text,
  description text,
  actual_start_date date,
  actual_end_date date,
  system_status text,
  normal_duration numeric,
  planned_work numeric,
  actual_work numeric,
  user_status text,
  operational_area text,
  confirmation text NOT NULL,
  has_confirmation boolean GENERATED ALWAYS AS (
    regexp_split_to_array(upper(coalesce(system_status, '')), E'\\s+') @> ARRAY['CONF']::text[]
  ) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (import_id, source_row_number)
);

CREATE INDEX sap_confirmation_imports_week_idx
  ON public.sap_confirmation_imports(worksite_id, week_id, imported_at DESC);
CREATE INDEX sap_confirmation_rows_week_confirmation_idx
  ON public.sap_confirmation_rows(worksite_id, week_id, confirmation);
CREATE INDEX sap_confirmation_rows_week_order_operation_idx
  ON public.sap_confirmation_rows(worksite_id, week_id, order_number, operation, suboperation);

GRANT SELECT ON public.sap_confirmation_imports, public.sap_confirmation_rows TO authenticated;
GRANT ALL ON public.sap_confirmation_imports, public.sap_confirmation_rows TO service_role;
ALTER TABLE public.sap_confirmation_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sap_confirmation_rows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sap imports visible within active worksite"
ON public.sap_confirmation_imports FOR SELECT TO authenticated
USING (public.can_access_worksite(auth.uid(), worksite_id));

CREATE POLICY "sap rows visible within active worksite"
ON public.sap_confirmation_rows FOR SELECT TO authenticated
USING (public.can_access_worksite(auth.uid(), worksite_id));

-- Retorna a situação SAP de todas as atividades da semana e o resumo necessário
-- para os cartões. A segunda-feira seguinte às 12h (America/Sao_Paulo) é o prazo.
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
    AND public.can_access_worksite(auth.uid(), w.worksite_id)
), latest_import AS (
  SELECT i.id
  FROM public.sap_confirmation_imports i
  JOIN selected_week w ON w.id = i.week_id AND w.worksite_id = i.worksite_id
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
    s.id sap_row_id, s.has_confirmation, coalesce(s.actual_work, 0) actual_work,
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
      WHEN m.operational_status IN ('NÃO EXECUTADO', 'CANCELADA') AND coalesce(m.has_confirmation, false)
        THEN 'Divergência'
      WHEN coalesce(m.has_confirmation, false) AND m.actual_work > 0
        THEN 'Confirmada no SAP'
      WHEN coalesce(m.has_confirmation, false)
        THEN 'Confirmada sem HH'
      WHEN m.operational_status IN ('NÃO EXECUTADO', 'CANCELADA')
        THEN 'Confirmação não esperada'
      WHEN now() <= (SELECT deadline FROM selected_week)
        THEN 'Aguardando confirmação'
      ELSE 'Não confirmada no SAP'
    END sap_status
  FROM matched m
  WHERE m.match_rank = 1
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
  'hasImport', EXISTS (SELECT 1 FROM latest_import),
  'importedRows', coalesce((SELECT count(*) FROM public.sap_confirmation_rows WHERE import_id = (SELECT id FROM latest_import)), 0),
  'statuses', coalesce((SELECT jsonb_object_agg(activity_id, sap_status) FROM classified), '{}'::jsonb),
  'counts', coalesce((SELECT jsonb_object_agg(sap_status, total) FROM counts), '{}'::jsonb),
  'unprogrammedCount', (SELECT count(*) FROM unprogrammed),
  'unprogrammed', coalesce((SELECT jsonb_agg(to_jsonb(u) ORDER BY u.actual_end_date, u.order_number, u.operation) FROM unprogrammed u), '[]'::jsonb)
)
FROM selected_week;
$$;

REVOKE ALL ON FUNCTION public.get_sap_confirmation_overview(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sap_confirmation_overview(uuid) TO authenticated;
