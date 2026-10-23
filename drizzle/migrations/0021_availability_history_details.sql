-- Compare immutable weekly snapshots on demand, without rewriting any historical records.
CREATE OR REPLACE FUNCTION public.get_weekly_rs_availability_changes(p_week_id uuid,p_version integer,p_offset integer DEFAULT 0,p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE w public.weeks%ROWTYPE; current_rows jsonb; previous_rows jsonb; result jsonb;
BEGIN
  SELECT * INTO w FROM public.weeks WHERE id=p_week_id;
  IF NOT FOUND OR NOT coalesce(public.can_access_sap(auth.uid()),false)
    OR NOT coalesce(public.can_access_worksite(auth.uid(),w.worksite_id),false) THEN
    RAISE EXCEPTION 'Sem acesso ao histórico de disponibilidade desta semana'; END IF;
  IF p_version IS NULL OR p_version<1 OR p_offset IS NULL OR p_offset<0 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Parâmetros inválidos'; END IF;
  SELECT h.rows INTO current_rows FROM public.weekly_rs_availability_history h
    WHERE h.week_id=p_week_id AND h.worksite_id=w.worksite_id AND h.version=p_version;
  IF NOT FOUND THEN RAISE EXCEPTION 'Versão não encontrada'; END IF;
  IF p_version=1 THEN previous_rows:='[]'::jsonb;
  ELSE SELECT h.rows INTO previous_rows FROM public.weekly_rs_availability_history h
    WHERE h.week_id=p_week_id AND h.worksite_id=w.worksite_id AND h.version=p_version-1;
  END IF;
  IF previous_rows IS NULL THEN RETURN jsonb_build_object('comparisonAvailable',false,'total',0,'rows','[]'::jsonb); END IF;
  WITH old_rows AS (
    SELECT upper(btrim(v->>'center')) center,v->>'date' change_date,v payload FROM jsonb_array_elements(previous_rows) v
  ), new_rows AS (
    SELECT upper(btrim(v->>'center')) center,v->>'date' change_date,v payload FROM jsonb_array_elements(current_rows) v
  ), changes AS MATERIALIZED (
    SELECT coalesce(n.center,o.center) center,coalesce(n.change_date,o.change_date) change_date,o.payload old_row,n.payload new_row,
      CASE WHEN o.payload IS NULL THEN 'included' WHEN n.payload IS NULL THEN 'removed' ELSE 'updated' END action
    FROM old_rows o FULL JOIN new_rows n ON n.center=o.center AND n.change_date=o.change_date
    WHERE o.payload IS DISTINCT FROM n.payload
  ) SELECT jsonb_build_object('comparisonAvailable',true,'total',(SELECT count(*) FROM changes),
    'included',(SELECT count(*) FROM changes WHERE action='included'),'removed',(SELECT count(*) FROM changes WHERE action='removed'),
    'updated',(SELECT count(*) FROM changes WHERE action='updated'),
    'rows',coalesce((SELECT jsonb_agg(jsonb_build_object('center',center,'date',change_date,'action',action,'before',old_row,'after',new_row) ORDER BY center,change_date)
      FROM (SELECT * FROM changes ORDER BY center,change_date LIMIT p_limit OFFSET p_offset) page),'[]'::jsonb)) INTO result;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.get_weekly_rs_availability_changes(uuid,integer,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_weekly_rs_availability_changes(uuid,integer,integer,integer) TO authenticated;
NOTIFY pgrst,'reload schema';
