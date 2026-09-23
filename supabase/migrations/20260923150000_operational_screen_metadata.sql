-- Agrega filtros e indicadores das telas operacionais sem transferir milhares
-- de registros para o servidor da aplicação.

CREATE OR REPLACE FUNCTION public.get_overtime_export_metadata(
  p_worksite_id uuid,
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL,
  p_entry_time text DEFAULT NULL,
  p_departure_time text DEFAULT NULL,
  p_transport text DEFAULT 'all',
  p_employee_search text DEFAULT ''
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH base AS (
    SELECT entry_time, departure_time, status, needs_snack, needs_transport
    FROM public.overtime_requests
    WHERE worksite_id = p_worksite_id
      AND status <> 'cancelled'
      AND (p_date_from IS NULL OR overtime_date >= p_date_from)
      AND (p_date_to IS NULL OR overtime_date <= p_date_to)
      AND (p_transport = 'all'
        OR (p_transport = 'yes' AND needs_transport)
        OR (p_transport = 'no' AND NOT needs_transport))
      AND (coalesce(trim(p_employee_search), '') = '' OR
        employee_name ILIKE '%' || trim(p_employee_search) || '%' OR
        employee_registration ILIKE '%' || trim(p_employee_search) || '%' OR
        employee_external_id ILIKE '%' || trim(p_employee_search) || '%')
  ), summary AS (
    SELECT * FROM base
    WHERE (p_entry_time IS NULL OR entry_time = p_entry_time)
      AND (p_departure_time IS NULL OR departure_time = p_departure_time)
  )
  SELECT jsonb_build_object(
    'entryTimes', coalesce((SELECT jsonb_agg(value ORDER BY value)
      FROM (SELECT DISTINCT entry_time AS value FROM base WHERE entry_time IS NOT NULL) q), '[]'::jsonb),
    'departureTimes', coalesce((SELECT jsonb_agg(value ORDER BY value)
      FROM (SELECT DISTINCT departure_time AS value FROM base
            WHERE departure_time IS NOT NULL
              AND (p_entry_time IS NULL OR entry_time = p_entry_time)) q), '[]'::jsonb),
    'kpis', jsonb_build_object(
      'total', (SELECT count(*) FROM summary),
      'pending', (SELECT count(*) FROM summary WHERE status = 'pending'),
      'approved', (SELECT count(*) FROM summary WHERE status = 'approved'),
      'rejected', (SELECT count(*) FROM summary WHERE status = 'rejected'),
      'snacks', (SELECT count(*) FROM summary WHERE status = 'approved' AND needs_snack),
      'transports', (SELECT count(*) FROM summary WHERE status = 'approved' AND needs_transport)
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.get_scheduled_transport_metadata(
  p_worksite_id uuid,
  p_date_from date,
  p_date_to date DEFAULT NULL,
  p_search text DEFAULT '',
  p_job_title text DEFAULT NULL,
  p_status text DEFAULT 'scheduled',
  p_transport text DEFAULT 'all',
  p_entry_time text DEFAULT NULL,
  p_departure_time text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH date_scope AS (
    SELECT transport_date, employee_role, entry_time, departure_time,
           employee_master_id, status, needs_transport, employee_name,
           employee_registration, employee_external_id, order_number,
           service_description, requester_name
    FROM public.scheduled_transport_requests
    WHERE worksite_id = p_worksite_id
      AND transport_date >= p_date_from
      AND (p_date_to IS NULL OR transport_date <= p_date_to)
  ), summary AS (
    SELECT * FROM date_scope
    WHERE (p_status = 'all' OR status = p_status)
      AND (p_job_title IS NULL OR employee_role = p_job_title)
      AND (p_transport = 'all'
        OR (p_transport = 'yes' AND needs_transport)
        OR (p_transport = 'no' AND NOT needs_transport))
      AND (p_entry_time IS NULL OR entry_time = p_entry_time)
      AND (p_departure_time IS NULL OR departure_time = p_departure_time)
      AND (coalesce(trim(p_search), '') = '' OR
        employee_name ILIKE '%' || trim(p_search) || '%' OR
        employee_registration ILIKE '%' || trim(p_search) || '%' OR
        employee_external_id ILIKE '%' || trim(p_search) || '%' OR
        employee_role ILIKE '%' || trim(p_search) || '%' OR
        order_number ILIKE '%' || trim(p_search) || '%' OR
        service_description ILIKE '%' || trim(p_search) || '%' OR
        requester_name ILIKE '%' || trim(p_search) || '%')
  )
  SELECT jsonb_build_object(
    'jobTitles', coalesce((SELECT jsonb_agg(value ORDER BY value)
      FROM (SELECT DISTINCT employee_role AS value FROM date_scope WHERE employee_role IS NOT NULL) q), '[]'::jsonb),
    'dates', coalesce((SELECT jsonb_agg(value ORDER BY value)
      FROM (SELECT DISTINCT transport_date AS value FROM date_scope) q), '[]'::jsonb),
    'entryTimes', coalesce((SELECT jsonb_agg(value ORDER BY value)
      FROM (SELECT DISTINCT entry_time AS value FROM date_scope WHERE entry_time IS NOT NULL) q), '[]'::jsonb),
    'departurePairs', coalesce((SELECT jsonb_agg(jsonb_build_object('entry', entry_time, 'departure', departure_time))
      FROM (SELECT DISTINCT entry_time, departure_time FROM date_scope) q), '[]'::jsonb),
    'kpis', jsonb_build_object(
      'employees', (SELECT count(DISTINCT employee_master_id) FROM summary WHERE status = 'scheduled'),
      'transport', (SELECT count(DISTINCT employee_master_id) FROM summary WHERE status = 'scheduled' AND needs_transport),
      'noTransport', (SELECT count(DISTINCT employee_master_id) FROM summary WHERE status = 'scheduled' AND NOT needs_transport),
      'cancelled', (SELECT count(DISTINCT employee_master_id) FROM summary WHERE status = 'cancelled')
    )
  );
$$;

REVOKE ALL ON FUNCTION public.get_overtime_export_metadata(uuid,date,date,text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_overtime_export_metadata(uuid,date,date,text,text,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.get_scheduled_transport_metadata(uuid,date,date,text,text,text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_scheduled_transport_metadata(uuid,date,date,text,text,text,text,text,text) TO service_role;
