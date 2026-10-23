-- Read-only earned progress, independent of operational statuses and RS exclusions.
-- Only derived task HH is exposed; source SAP records retain their planning-only permissions.
CREATE OR REPLACE FUNCTION public.activity_sap_earned(p_week_id uuid)
RETURNS TABLE(activity_id uuid, progress_date date, planned numeric, earned numeric, has_source boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE w public.weeks%ROWTYPE; source_id uuid; g record; s record; t record;
  credits jsonb; remaining numeric; allocation numeric; weight numeric;
BEGIN
  SELECT * INTO w FROM public.weeks WHERE id=p_week_id;
  IF NOT FOUND OR auth.uid() IS NULL OR NOT coalesce(public.can_access_worksite(auth.uid(),w.worksite_id),false)
    OR (w.lifecycle_status='preparation' AND NOT (coalesce(public.has_role(auth.uid(),'planning'),false)
      OR coalesce(public.has_role(auth.uid(),'admin'),false) OR coalesce(public.has_role(auth.uid(),'operation'),false))) THEN
    RAISE EXCEPTION 'Sem acesso ao avanço desta semana';
  END IF;
  SELECT i.id INTO source_id FROM public.sap_confirmation_imports i
    WHERE i.week_id=p_week_id AND i.worksite_id=w.worksite_id
      AND EXISTS(SELECT 1 FROM public.sap_confirmation_rows r WHERE r.import_id=i.id AND r.worksite_id=w.worksite_id)
    ORDER BY i.imported_at DESC,i.id DESC LIMIT 1;
  -- Group before allocating. Neither filtering nor pagination can reset a confirmation budget.
  FOR g IN WITH program AS MATERIALIZED (
    SELECT a.id,a.scheduled_date,
      regexp_replace(regexp_replace(btrim(coalesce(a.planning_data->>'Confirmação',a.planning_data->>'Confirmacao','')),'([,.]0+)$','','g'),'^0+','') confirmation,
      CASE WHEN h.normalized ~ '^[0-9]+(\.[0-9]+)?$' THEN h.normalized::numeric END planned_hh
    FROM public.activities a CROSS JOIN LATERAL (
      SELECT regexp_replace(btrim(coalesce(a.planning_data->>'Trab',a.planning_data->>'TRAB',a.planning_data->>'trab','')),'\s*h(oras?)?$','','i') cleaned
    ) raw CROSS JOIN LATERAL (SELECT CASE WHEN position(',' in raw.cleaned)>0 THEN replace(replace(raw.cleaned,'.',''),',','.') ELSE raw.cleaned END normalized) h
    WHERE a.week_id=p_week_id AND a.worksite_id=w.worksite_id AND NOT a.is_immediate
      AND (nullif(btrim(coalesce(a.order_number,'')),'') IS NOT NULL
        OR nullif(btrim(coalesce(a.description,'')),'') IS NOT NULL
        OR nullif(btrim(coalesce(a.planning_data->>'Confirmação',a.planning_data->>'Confirmacao','')),'') IS NOT NULL)
  ), programs AS (
    SELECT p.confirmation,jsonb_agg(jsonb_build_object('id',p.id,'date',p.scheduled_date,'hh',p.planned_hh) ORDER BY p.scheduled_date,p.id) tasks
    FROM program p GROUP BY p.confirmation
  ), sap AS (
    SELECT regexp_replace(regexp_replace(btrim(coalesce(r.confirmation,'')),'([,.]0+)$','','g'),'^0+','') confirmation,
      jsonb_agg(jsonb_build_object('id',r.id,'actual_work',r.actual_work,'first_day',coalesce(r.actual_start_date,r.actual_end_date),'last_day',coalesce(r.actual_end_date,r.actual_start_date))) records
    FROM public.sap_confirmation_rows r WHERE r.import_id=source_id AND r.worksite_id=w.worksite_id AND r.week_id=p_week_id
      AND r.has_confirmation AND r.actual_work>0 AND (r.actual_start_date IS NOT NULL OR r.actual_end_date IS NOT NULL)
    GROUP BY 1
  ) SELECT p.*,coalesce(matched.records,'[]'::jsonb) sap FROM programs p LEFT JOIN sap matched ON matched.confirmation=p.confirmation AND p.confirmation<>''
  LOOP
    credits:='{}'::jsonb;
    -- Narrow execution windows first, so an aggregate spanning the week cannot consume their slots.
    FOR s IN SELECT * FROM jsonb_to_recordset(g.sap) AS r(id uuid,actual_work numeric,first_day date,last_day date)
      ORDER BY r.last_day-r.first_day,r.first_day,r.id
    LOOP
      SELECT coalesce(sum(greatest(0,(v->>'hh')::numeric-coalesce((credits->>(v->>'id'))::numeric,0))),0) INTO weight
        FROM jsonb_array_elements(g.tasks) v WHERE (v->>'date')::date BETWEEN s.first_day AND s.last_day;
      remaining:=least(s.actual_work,weight);
      IF weight>0 THEN
        FOR t IN SELECT v FROM jsonb_array_elements(g.tasks) v WHERE (v->>'date')::date BETWEEN s.first_day AND s.last_day LOOP
          allocation:=remaining*greatest(0,(t.v->>'hh')::numeric-coalesce((credits->>(t.v->>'id'))::numeric,0))/weight;
          credits:=jsonb_set(credits,ARRAY[t.v->>'id'],to_jsonb(coalesce((credits->>(t.v->>'id'))::numeric,0)+allocation));
        END LOOP;
      END IF;
    END LOOP;
    FOR t IN SELECT v FROM jsonb_array_elements(g.tasks) v LOOP
      activity_id:=(t.v->>'id')::uuid; progress_date:=(t.v->>'date')::date;
      planned:=(t.v->>'hh')::numeric; earned:=least(planned,coalesce((credits->>(t.v->>'id'))::numeric,0));
      has_source:=source_id IS NOT NULL; RETURN NEXT;
    END LOOP;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.activity_sap_earned(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.activity_sap_earned(uuid) TO authenticated;


NOTIFY pgrst,'reload schema';
