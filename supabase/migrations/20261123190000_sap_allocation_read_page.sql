-- Auxiliary daily SAP allocation needs rows, not page KPIs/facets/progress.
-- Retain the exact existing activity RLS and the SAP-view permission.
CREATE OR REPLACE FUNCTION public.get_activity_sap_allocation_page(
 p_week_id uuid,p_page integer DEFAULT 0,p_page_size integer DEFAULT 500
) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
 WITH eligible AS MATERIALIZED (
  SELECT a.id,a.order_number,a.planning_data,a.scheduled_date,a.source_row_number
  FROM public.activities a WHERE a.week_id=p_week_id
   AND (SELECT public.can_view_activity_sap(auth.uid()))
 ), page AS (
  SELECT * FROM eligible ORDER BY nullif(order_number,'') NULLS LAST,
   nullif(planning_data->>'Op','') NULLS LAST,nullif(planning_data->>'Subop','') NULLS LAST,
   source_row_number NULLS LAST
  LIMIT greatest(1,least(p_page_size,5000)) OFFSET greatest(0,p_page)*greatest(1,least(p_page_size,5000))
 ) SELECT jsonb_build_object('rows',coalesce((SELECT jsonb_agg(to_jsonb(p)) FROM page p),'[]'::jsonb),
  'totalAll',(SELECT count(*) FROM eligible));
$$;
REVOKE ALL ON FUNCTION public.get_activity_sap_allocation_page(uuid,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_activity_sap_allocation_page(uuid,integer,integer) TO authenticated;
NOTIFY pgrst,'reload schema';
