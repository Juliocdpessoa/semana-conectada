CREATE OR REPLACE FUNCTION public.get_overtime_export_pt_options(
 p_worksite_id uuid,p_date_from date DEFAULT NULL,p_date_to date DEFAULT NULL,
 p_entry_time text DEFAULT NULL,p_departure_time text DEFAULT NULL,p_transport text DEFAULT 'all',
 p_employee_search text DEFAULT '',p_pt_search text DEFAULT '',p_pt_number text DEFAULT ''
) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
WITH source AS (
 SELECT entry_time,departure_time,status,needs_snack,needs_transport,pt_number
 FROM public.overtime_requests WHERE worksite_id=p_worksite_id AND status<>'cancelled'
 AND (p_date_from IS NULL OR overtime_date>=p_date_from) AND (p_date_to IS NULL OR overtime_date<=p_date_to)
 AND (p_transport='all' OR (p_transport='yes' AND needs_transport) OR (p_transport='no' AND NOT needs_transport))
 AND (coalesce(trim(p_employee_search),'')='' OR employee_name ILIKE '%'||trim(p_employee_search)||'%'
 OR employee_registration ILIKE '%'||trim(p_employee_search)||'%' OR employee_external_id ILIKE '%'||trim(p_employee_search)||'%')
),base AS (
 SELECT * FROM source WHERE CASE WHEN p_pt_search='__NEXO_EMPTY_PT__' THEN coalesce(pt_number,'')=''
 WHEN coalesce(p_pt_number,'')<>'' THEN pt_number=p_pt_number
 ELSE coalesce(trim(p_pt_search),'')='' OR position(lower(trim(p_pt_search)) in lower(coalesce(pt_number,'')))>0 END
),summary AS (
 SELECT * FROM base WHERE (p_entry_time IS NULL OR entry_time=p_entry_time) AND (p_departure_time IS NULL OR departure_time=p_departure_time)
)
SELECT jsonb_build_object(
 'ptNumbers',coalesce((SELECT jsonb_agg(value ORDER BY value) FROM (
 SELECT DISTINCT pt_number value FROM source WHERE nullif(trim(pt_number),'') IS NOT NULL
 AND (p_entry_time IS NULL OR entry_time=p_entry_time) AND (p_departure_time IS NULL OR departure_time=p_departure_time)) q),'[]'::jsonb),
 'entryTimes',coalesce((SELECT jsonb_agg(value ORDER BY value) FROM (SELECT DISTINCT entry_time value FROM base WHERE entry_time IS NOT NULL) q),'[]'::jsonb),
 'departureTimes',coalesce((SELECT jsonb_agg(value ORDER BY value) FROM (SELECT DISTINCT departure_time value FROM base WHERE departure_time IS NOT NULL AND (p_entry_time IS NULL OR entry_time=p_entry_time)) q),'[]'::jsonb),
 'kpis',jsonb_build_object('total',(SELECT count(*) FROM summary),'pending',(SELECT count(*) FROM summary WHERE status='pending'),
 'approved',(SELECT count(*) FROM summary WHERE status='approved'),'rejected',(SELECT count(*) FROM summary WHERE status='rejected'),
 'snacks',(SELECT count(*) FROM summary WHERE status='approved' AND needs_snack),'transports',(SELECT count(*) FROM summary WHERE status='approved' AND needs_transport)));
$$;
REVOKE ALL ON FUNCTION public.get_overtime_export_pt_options(uuid,date,date,text,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_overtime_export_pt_options(uuid,date,date,text,text,text,text,text,text) TO service_role;
