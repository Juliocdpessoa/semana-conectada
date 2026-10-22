-- Small operational aggregates only. Never exposes SAP or the editable availability source.
CREATE OR REPLACE FUNCTION public.get_activity_daily_capacity(p_week_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE w public.weeks%ROWTYPE; result jsonb;
BEGIN
  SELECT * INTO w FROM public.weeks WHERE id=p_week_id;
  IF NOT FOUND OR auth.uid() IS NULL
    OR NOT coalesce(public.can_access_worksite(auth.uid(),w.worksite_id),false)
    OR (w.lifecycle_status='preparation' AND NOT (
      coalesce(public.has_role(auth.uid(),'planning'),false)
      OR coalesce(public.has_role(auth.uid(),'admin'),false)
      OR coalesce(public.has_role(auth.uid(),'operation'),false))) THEN
    RAISE EXCEPTION 'Sem acesso à capacidade desta semana';
  END IF;
  WITH capacity AS (
    SELECT upper(regexp_replace(btrim(r->>'center'),'\s+',' ','g')) center,
      (r->>'date')::date capacity_date,sum((r->>'hours')::numeric) available
    FROM public.weekly_rs_availability v CROSS JOIN LATERAL jsonb_array_elements(v.rows) r
    WHERE v.week_id=p_week_id AND v.worksite_id=w.worksite_id
    GROUP BY 1,2
  ), workload AS MATERIALIZED (
    SELECT upper(regexp_replace(btrim(coalesce(nullif(btrim(a.planning_data->>'CenTrab'),''),
      nullif(btrim(a.planning_data->>'CENTRO_DE_TRABALHO'),''),
      nullif(btrim(a.planning_data->>'Centro de trabalho'),''),'')),'\s+',' ','g')) center,
      a.scheduled_date capacity_date,
      CASE WHEN position(',' in h.cleaned)>0 THEN replace(replace(h.cleaned,'.',''),',','.') ELSE h.cleaned END normalized
    FROM public.activities a
    CROSS JOIN LATERAL (SELECT regexp_replace(btrim(coalesce(a.planning_data->>'Trab',a.planning_data->>'TRAB',a.planning_data->>'trab','')),'\s*h(oras?)?$','','i') cleaned) h
    WHERE a.week_id=p_week_id AND a.worksite_id=w.worksite_id AND a.status IS DISTINCT FROM 'CANCELADA'
  ), scheduled AS (
    SELECT center,capacity_date,count(*) tasks,
      coalesce(sum(CASE WHEN normalized ~ '^[0-9]+(\.[0-9]+)?$' THEN normalized::numeric ELSE 0 END),0) programmed,
      count(*) FILTER (WHERE normalized !~ '^[0-9]+(\.[0-9]+)?$') invalid_hours
    FROM workload GROUP BY center,capacity_date
  ), combined AS (
    SELECT coalesce(s.center,c.center) center,coalesce(s.capacity_date,c.capacity_date) capacity_date,
      coalesce(s.programmed,0) programmed,c.available,coalesce(s.tasks,0) tasks,
      coalesce(s.invalid_hours,0) invalid_hours
    FROM scheduled s FULL JOIN capacity c ON c.center=s.center AND c.capacity_date=s.capacity_date
  )
  SELECT jsonb_build_object(
    'hasAvailability',EXISTS(SELECT 1 FROM public.weekly_rs_availability WHERE week_id=p_week_id AND worksite_id=w.worksite_id),
    'updatedAt',(SELECT updated_at FROM public.weekly_rs_availability WHERE week_id=p_week_id AND worksite_id=w.worksite_id),
    'rows',coalesce((SELECT jsonb_agg(jsonb_build_object('center',center,'date',capacity_date,
      'programmed',programmed,'available',available,'tasks',tasks,'invalidHours',invalid_hours,
      'excess',CASE WHEN available IS NOT NULL AND invalid_hours=0 AND center<>'' AND capacity_date IS NOT NULL THEN greatest(0,programmed-available) END)
      ORDER BY capacity_date NULLS LAST,center) FROM combined),'[]'::jsonb)
  ) INTO result;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.get_activity_daily_capacity(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_activity_daily_capacity(uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
