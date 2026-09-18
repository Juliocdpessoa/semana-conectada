CREATE OR REPLACE FUNCTION public.get_activities_page(p_week_id uuid, p_filters jsonb DEFAULT '{}'::jsonb, p_page integer DEFAULT 0, p_page_size integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
WITH params AS (
  SELECT
    lower(btrim(coalesce(p_filters->>'search',''))) search,
    coalesce(p_filters->'statuses','[]'::jsonb) statuses,
    coalesce(p_filters->'releaseTypes','[]'::jsonb) release_types,
    coalesce(p_filters->'ptColors','[]'::jsonb) pt_colors,
    coalesce(p_filters->'areas','[]'::jsonb) areas,
    coalesce(p_filters->'locations','[]'::jsonb) locations,
    coalesce(p_filters->'workCenters','[]'::jsonb) work_centers,
    coalesce(p_filters->'planningGroups','[]'::jsonb) planning_groups,
    coalesce(p_filters->'gers','[]'::jsonb) gers,
    coalesce(p_filters->'dates','[]'::jsonb) dates,
    coalesce(p_filters->'origins','[]'::jsonb) origins
), base AS (
  SELECT a.*,
    CASE
      WHEN coalesce(a.planning_data->>'Gerência','') !~ '^[0-9 .,]+$' AND btrim(coalesce(a.planning_data->>'Gerência','')) <> '' THEN btrim(a.planning_data->>'Gerência')
      WHEN coalesce(a.area,'') !~ '^[0-9 .,]+$' AND btrim(coalesce(a.area,'')) <> '' THEN btrim(a.area)
      ELSE NULL
    END AS area_label,
    nullif(btrim(coalesce(a.planning_data->>'Localização','')),'') AS location_label,
    coalesce(nullif(btrim(a.planning_data->>'CenTrab'),''), nullif(btrim(a.planning_data->>'CENTRO_DE_TRABALHO'),''), nullif(btrim(a.planning_data->>'Centro de trabalho'),'')) AS work_center,
    coalesce(nullif(btrim(a.planning_data->>'Gr pl'),''), nullif(btrim(a.planning_data->>'GR PL'),''), nullif(btrim(a.planning_data->>'Gr Pl'),'')) AS planning_group,
    CASE upper(btrim(coalesce(a.planning_data->>'Área op',a.planning_data->>'Área Op',a.planning_data->>'Area Op','')))
      WHEN '50' THEN 'TE' WHEN '20' THEN 'CRA' WHEN '40' THEN 'HDT' WHEN '30' THEN 'DE'
      WHEN '10' THEN 'CQG' WHEN '60' THEN 'UT' WHEN '70' THEN 'SMS' WHEN '4' THEN 'OFICINAS'
      WHEN '6' THEN 'INFRA' WHEN 'LAB' THEN 'LAB' WHEN 'PRO' THEN 'UTE' WHEN 'MAN' THEN 'UTE'
      WHEN 'SMS' THEN 'UTE' ELSE 'Não mapeado' END AS ger_label,
    CASE WHEN a.release_type IN ('ATRE','OFICINAS') THEN NULL WHEN a.pt_color IS NOT NULL THEN a.pt_color WHEN a.release_type='PTT' THEN 'white' ELSE NULL END AS effective_pt_color,
    CASE WHEN a.is_immediate THEN 'immediate' ELSE 'programmed' END AS origin_label,
    CASE
      WHEN jsonb_typeof(a.planning_data->'Trab')='number' THEN greatest(0,(a.planning_data->>'Trab')::numeric)
      WHEN btrim(coalesce(a.planning_data->>'Trab',a.planning_data->>'TRAB',a.planning_data->>'trab','')) ~ '^[0-9]+(\.[0-9]+)?$'
        THEN btrim(coalesce(a.planning_data->>'Trab',a.planning_data->>'TRAB',a.planning_data->>'trab',''))::numeric
      WHEN btrim(coalesce(a.planning_data->>'Trab',a.planning_data->>'TRAB',a.planning_data->>'trab','')) ~ '^[0-9]+(,[0-9]+)?$'
        THEN replace(btrim(coalesce(a.planning_data->>'Trab',a.planning_data->>'TRAB',a.planning_data->>'trab','')),',','.')::numeric
      ELSE 0 END AS planned_hours
  FROM public.activities a WHERE a.week_id=p_week_id
), marked AS (
  SELECT b.*,
    (p.search='' OR lower(coalesce(b.order_number,'')) LIKE '%'||p.search||'%' OR lower(coalesce(b.note_number,'')) LIKE '%'||p.search||'%' OR lower(coalesce(b.description,'')) LIKE '%'||p.search||'%' OR lower(coalesce(b.area,'')) LIKE '%'||p.search||'%' OR lower(coalesce(b.specialty,'')) LIKE '%'||p.search||'%' OR lower(coalesce(b.planning_data->>'Op','')) LIKE '%'||p.search||'%' OR lower(coalesce(b.planning_data->>'Subop','')) LIKE '%'||p.search||'%' OR lower(coalesce(b.pt_number,'')) LIKE '%'||p.search||'%' OR lower(coalesce(b.reported_by_name,'')) LIKE '%'||p.search||'%') pass_search,
    (jsonb_array_length(p.statuses)=0 OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(p.statuses) s WHERE s=b.status OR (s='__PENDING_REPORT__' AND b.status IN ('Sem apontamento','AGUARDANDO PRÉ-EMISSÃO DE PT','PT EM ASSINATURA','PT ENVIADA P/ CAMPO')))) pass_status,
    (jsonb_array_length(p.release_types)=0 OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(p.release_types) x WHERE x=b.release_type OR (x='__EMPTY__' AND b.release_type IS NULL))) pass_release,
    (jsonb_array_length(p.pt_colors)=0 OR p.pt_colors ? coalesce(b.effective_pt_color,'')) pass_color,
    (jsonb_array_length(p.areas)=0 OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(p.areas) x WHERE upper(btrim(x))=upper(btrim(coalesce(b.area_label,''))))) pass_area,
    (jsonb_array_length(p.locations)=0 OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(p.locations) x WHERE upper(btrim(x))=upper(btrim(coalesce(b.location_label,''))))) pass_location,
    (jsonb_array_length(p.work_centers)=0 OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(p.work_centers) x WHERE upper(btrim(x))=upper(btrim(coalesce(b.work_center,''))))) pass_work_center,
    (jsonb_array_length(p.planning_groups)=0 OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(p.planning_groups) x WHERE upper(btrim(x))=upper(btrim(coalesce(b.planning_group,''))))) pass_planning_group,
    (jsonb_array_length(p.gers)=0 OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(p.gers) x WHERE upper(btrim(x))=upper(btrim(b.ger_label)))) pass_ger,
    (jsonb_array_length(p.dates)=0 OR p.dates ? coalesce(b.scheduled_date::text,'')) pass_date,
    (jsonb_array_length(p.origins)=0 OR p.origins ? b.origin_label) pass_origin
  FROM base b CROSS JOIN params p
), filtered AS (
  SELECT * FROM marked WHERE pass_search AND pass_status AND pass_release AND pass_color AND pass_area AND pass_location AND pass_work_center AND pass_planning_group AND pass_ger AND pass_date AND pass_origin
), summary AS (
  SELECT count(*)::int total,
    count(*) FILTER (WHERE status='EXECUTADO')::int concluded,
    count(*) FILTER (WHERE status='NÃO EXECUTADO')::int impeded,
    count(*) FILTER (WHERE status IN ('Sem apontamento','AGUARDANDO PRÉ-EMISSÃO DE PT','PT EM ASSINATURA','PT ENVIADA P/ CAMPO'))::int no_report,
    count(*) FILTER (WHERE status='CANCELADA')::int cancelled,
    coalesce(sum(planned_hours),0)::numeric hours
  FROM filtered
)
SELECT jsonb_build_object(
  'rows',coalesce((SELECT jsonb_agg(to_jsonb(x) - ARRAY['area_label','location_label','work_center','planning_group','ger_label','effective_pt_color','origin_label','planned_hours','pass_search','pass_status','pass_release','pass_color','pass_area','pass_location','pass_work_center','pass_planning_group','pass_ger','pass_date','pass_origin']::text[]) FROM (SELECT * FROM filtered ORDER BY nullif(order_number,'') NULLS LAST, nullif(planning_data->>'Op','') NULLS LAST, nullif(planning_data->>'Subop','') NULLS LAST, source_row_number NULLS LAST LIMIT greatest(1,least(p_page_size,5000)) OFFSET greatest(0,p_page)*greatest(1,least(p_page_size,5000))) x),'[]'::jsonb),
  'totalAll',(SELECT count(*) FROM base),
  'kpis',(SELECT jsonb_build_object('total',total,'concluded',concluded,'impeded',impeded,'noReport',no_report,'cancelled',cancelled,'hours',hours,'percent',CASE WHEN total-cancelled>0 THEN round(concluded*100.0/(total-cancelled)) ELSE 0 END) FROM summary),
  'options',jsonb_build_object(
    'statuses',coalesce((SELECT jsonb_agg(DISTINCT status) FROM marked WHERE pass_search AND pass_release AND pass_color AND pass_area AND pass_location AND pass_work_center AND pass_planning_group AND pass_ger AND pass_date AND pass_origin),'[]'::jsonb),
    'releaseTypes',coalesce((SELECT jsonb_agg(DISTINCT release_type) FILTER (WHERE release_type IS NOT NULL) FROM marked WHERE pass_search AND pass_status AND pass_color AND pass_area AND pass_location AND pass_work_center AND pass_planning_group AND pass_ger AND pass_date AND pass_origin),'[]'::jsonb),
    'hasEmptyReleaseType',EXISTS(SELECT 1 FROM marked WHERE release_type IS NULL AND pass_search AND pass_status AND pass_color AND pass_area AND pass_location AND pass_work_center AND pass_planning_group AND pass_ger AND pass_date AND pass_origin),
    'ptColors',coalesce((SELECT jsonb_agg(DISTINCT effective_pt_color) FILTER (WHERE effective_pt_color IS NOT NULL) FROM marked WHERE pass_search AND pass_status AND pass_release AND pass_area AND pass_location AND pass_work_center AND pass_planning_group AND pass_ger AND pass_date AND pass_origin),'[]'::jsonb),
    'areas',coalesce((SELECT jsonb_agg(DISTINCT area_label) FILTER (WHERE area_label IS NOT NULL) FROM marked WHERE pass_search AND pass_status AND pass_release AND pass_color AND pass_location AND pass_work_center AND pass_planning_group AND pass_ger AND pass_date AND pass_origin),'[]'::jsonb),
    'locations',coalesce((SELECT jsonb_agg(DISTINCT location_label) FILTER (WHERE location_label IS NOT NULL) FROM marked WHERE pass_search AND pass_status AND pass_release AND pass_color AND pass_area AND pass_work_center AND pass_planning_group AND pass_ger AND pass_date AND pass_origin),'[]'::jsonb),
    'workCenters',coalesce((SELECT jsonb_agg(DISTINCT work_center) FILTER (WHERE work_center IS NOT NULL) FROM marked WHERE pass_search AND pass_status AND pass_release AND pass_color AND pass_area AND pass_location AND pass_planning_group AND pass_ger AND pass_date AND pass_origin),'[]'::jsonb),
    'planningGroups',coalesce((SELECT jsonb_agg(DISTINCT planning_group) FILTER (WHERE planning_group IS NOT NULL) FROM marked WHERE pass_search AND pass_status AND pass_release AND pass_color AND pass_area AND pass_location AND pass_work_center AND pass_ger AND pass_date AND pass_origin),'[]'::jsonb),
    'gers',coalesce((SELECT jsonb_agg(DISTINCT ger_label) FROM marked WHERE pass_search AND pass_status AND pass_release AND pass_color AND pass_area AND pass_location AND pass_work_center AND pass_planning_group AND pass_date AND pass_origin),'[]'::jsonb),
    'dates',coalesce((SELECT jsonb_agg(DISTINCT scheduled_date) FILTER (WHERE scheduled_date IS NOT NULL) FROM marked WHERE pass_search AND pass_status AND pass_release AND pass_color AND pass_area AND pass_location AND pass_work_center AND pass_planning_group AND pass_ger AND pass_origin),'[]'::jsonb),
    'origins',coalesce((SELECT jsonb_agg(DISTINCT origin_label) FROM marked WHERE pass_search AND pass_status AND pass_release AND pass_color AND pass_area AND pass_location AND pass_work_center AND pass_planning_group AND pass_ger AND pass_date),'[]'::jsonb)
  )
);
$function$;