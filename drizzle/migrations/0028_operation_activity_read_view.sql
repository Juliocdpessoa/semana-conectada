-- Operation gets planning-equivalent READ access on Activities only.
-- Import, RS administration and activity-update permissions are not changed.
CREATE OR REPLACE FUNCTION public.can_view_activity_sap(_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT public.can_access_sap(_user_id)
   OR (public.is_approved(_user_id) AND public.has_role(_user_id,'operation'));
$$;
REVOKE ALL ON FUNCTION public.can_view_activity_sap(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_view_activity_sap(uuid) TO authenticated;

CREATE POLICY operation_activity_sap_imports_read ON public.sap_confirmation_imports
FOR SELECT TO authenticated USING (
 public.can_view_activity_sap(auth.uid()) AND public.can_access_worksite(auth.uid(),worksite_id)
);
CREATE POLICY operation_activity_sap_rows_read ON public.sap_confirmation_rows
FOR SELECT TO authenticated USING (
 public.can_view_activity_sap(auth.uid()) AND public.can_access_worksite(auth.uid(),worksite_id)
);

CREATE OR REPLACE FUNCTION public.get_sap_confirmation_overview(p_week_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
WITH selected_week AS (
  SELECT w.*,
    coalesce(w.sap_closure_deadline,
        ((w.end_date+((8-extract(isodow FROM w.end_date)::integer)%7))::date::timestamp+interval '12 hours')
          AT TIME ZONE 'America/Sao_Paulo') AS deadline
  FROM public.weeks w
  WHERE w.id=p_week_id AND public.can_view_activity_sap(auth.uid())
    AND public.can_access_worksite(auth.uid(),w.worksite_id)
), latest_import AS (
  SELECT i.id,i.row_count FROM public.sap_confirmation_imports i
  JOIN selected_week w ON w.id=i.week_id AND w.worksite_id=i.worksite_id
  WHERE EXISTS (SELECT 1 FROM public.sap_confirmation_rows r WHERE r.import_id=i.id)
  ORDER BY i.imported_at DESC,i.id DESC LIMIT 1
), activity_base AS MATERIALIZED (
  SELECT a.*,
    public.normalize_sap_identifier(coalesce(a.planning_data->>'Confirmação',a.planning_data->>'Confirmacao')) activity_confirmation,
    public.normalize_sap_identifier(a.order_number) activity_order,
    public.normalize_sap_identifier(coalesce(a.planning_data->>'Op',a.planning_data->>'Operação')) activity_operation,
    public.normalize_sap_identifier(coalesce(a.planning_data->>'Subop',a.planning_data->>'Suboperação')) activity_suboperation,
    nullif(upper(btrim(a.planning_data->>'CenTrab')),'') activity_center
  FROM public.activities a JOIN selected_week w ON w.id=a.week_id AND w.worksite_id=a.worksite_id
), normalized_sap AS MATERIALIZED (
  SELECT s.*,
    public.normalize_sap_identifier(s.confirmation) confirmation_key,
    public.normalize_sap_identifier(s.order_number) order_key,
    public.normalize_sap_identifier(s.operation) operation_key,
    public.normalize_sap_identifier(s.suboperation) suboperation_key,
    nullif(upper(btrim(s.work_center)),'') center_key
  FROM public.sap_confirmation_rows s
  JOIN selected_week w ON s.week_id=w.id AND s.worksite_id=w.worksite_id
  WHERE s.import_id=(SELECT id FROM latest_import)
), matched AS (
  SELECT a.id activity_id,a.status operational_status,a.is_immediate,a.sap_status_snapshot,
    s.id sap_row_id,s.has_confirmation,coalesce(s.actual_work,0) actual_work,
    row_number() OVER (PARTITION BY a.id ORDER BY
      CASE WHEN a.activity_confirmation IS NOT NULL AND s.confirmation_key=a.activity_confirmation THEN 0 ELSE 1 END,
      CASE WHEN a.scheduled_date=s.actual_end_date THEN 0 ELSE 1 END,s.source_row_number,s.id) match_rank
  FROM activity_base a LEFT JOIN normalized_sap s
    ON s.order_key=a.activity_order
   AND s.operation_key IS NOT DISTINCT FROM a.activity_operation
   -- A missing suboperation means the main operation, never a wildcard for its children.
   AND s.suboperation_key IS NOT DISTINCT FROM a.activity_suboperation
   -- A provided confirmation is authoritative; do not silently replace it with another.
   AND (a.activity_confirmation IS NULL OR s.confirmation_key=a.activity_confirmation)
   AND (a.activity_confirmation IS NOT NULL OR a.activity_center IS NULL OR s.center_key=a.activity_center)
), classified AS (
  SELECT m.activity_id,m.sap_row_id,m.actual_work,
    CASE
      WHEN NOT EXISTS (SELECT 1 FROM latest_import) THEN m.sap_status_snapshot
      WHEN m.operational_status IN ('NÃO EXECUTADO','CANCELADA') AND coalesce(m.has_confirmation,false) THEN 'Divergência'
      WHEN coalesce(m.has_confirmation,false) AND m.actual_work>0 THEN 'Confirmada no SAP'
      WHEN coalesce(m.has_confirmation,false) THEN 'Confirmada sem HH'
      WHEN m.operational_status IN ('NÃO EXECUTADO','CANCELADA') THEN 'Confirmação não esperada'
      WHEN (SELECT sap_closure_status FROM selected_week)='closed' THEN 'Não confirmada no SAP'
      WHEN now()<=(SELECT deadline FROM selected_week) THEN 'Aguardando confirmação'
      ELSE 'Não confirmada no SAP' END sap_status
  FROM matched m WHERE m.match_rank=1
    AND (EXISTS (SELECT 1 FROM latest_import) OR m.sap_status_snapshot IS NOT NULL)
), linked_sap AS (
  SELECT DISTINCT sap_row_id FROM matched WHERE sap_row_id IS NOT NULL
), unprogrammed AS (
  SELECT s.id,s.order_number,s.operation,s.suboperation,s.description,s.actual_start_date,s.actual_end_date,
    s.actual_work,s.confirmation,s.planning_code,
    CASE WHEN nullif(regexp_replace(regexp_replace(btrim(coalesce(s.planning_code,'')),'([,.]0+)$','','g'),'^0+',''),'')='2'
      THEN 'IMEDIATA' ELSE 'NÃO PROGRAMADA' END classification,
    'Confirmada no SAP'::text sap_status
  FROM public.sap_confirmation_rows s WHERE s.import_id=(SELECT id FROM latest_import)
    AND s.has_confirmation AND coalesce(s.actual_work,0)>0
    AND nullif(regexp_replace(regexp_replace(btrim(coalesce(s.planning_code,'')),'([,.]0+)$','','g'),'^0+',''),'') IN ('1','2')
    AND NOT EXISTS (SELECT 1 FROM linked_sap l WHERE l.sap_row_id=s.id)
), counts AS (
  SELECT sap_status,count(*)::integer total FROM classified GROUP BY sap_status
)
SELECT jsonb_build_object(
  'deadline',(SELECT deadline FROM selected_week),
  'closureStatus',(SELECT sap_closure_status FROM selected_week),
  'hasImport',EXISTS(SELECT 1 FROM latest_import) OR EXISTS(SELECT 1 FROM classified),
  'isSnapshot',NOT EXISTS(SELECT 1 FROM latest_import) AND EXISTS(SELECT 1 FROM classified),
  'importedRows',coalesce((SELECT row_count FROM latest_import),(SELECT count(*) FROM classified),0),
  'statuses',coalesce((SELECT jsonb_object_agg(activity_id,sap_status) FROM classified),'{}'::jsonb),
  'hours',coalesce((SELECT jsonb_object_agg(activity_id,actual_work) FROM classified WHERE sap_row_id IS NOT NULL),'{}'::jsonb),
  'counts',coalesce((SELECT jsonb_object_agg(sap_status,total) FROM counts),'{}'::jsonb),
  'unprogrammedCount',(SELECT count(*) FROM unprogrammed WHERE classification='NÃO PROGRAMADA'),
  'immediateCount',(SELECT count(*) FROM unprogrammed WHERE classification='IMEDIATA'),
  'unprogrammed',coalesce((SELECT jsonb_agg(to_jsonb(u) ORDER BY u.actual_end_date,u.order_number,u.operation) FROM unprogrammed u),'[]'::jsonb)
) FROM selected_week;
$function$;
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
    coalesce(p_filters->'origins','[]'::jsonb) origins,
     CASE WHEN (SELECT public.can_view_activity_sap(auth.uid())) THEN coalesce(p_filters->'sapStatuses','[]'::jsonb) ELSE '[]'::jsonb END sap_statuses
), base AS (
  SELECT a.*,
     CASE WHEN (SELECT public.can_view_activity_sap(auth.uid())) THEN p_filters->'sapStatusById'->>a.id::text END AS effective_sap_status,
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
     (jsonb_array_length(p.sap_statuses)=0 OR p.sap_statuses ? coalesce(b.effective_sap_status,'')) pass_sap,
    (p.search='' OR lower(coalesce(b.order_number,'')) LIKE '%'||p.search||'%' OR lower(coalesce(b.note_number,'')) LIKE '%'||p.search||'%' OR lower(coalesce(b.description,'')) LIKE '%'||p.search||'%' OR lower(coalesce(b.area,'')) LIKE '%'||p.search||'%' OR lower(coalesce(b.specialty,'')) LIKE '%'||p.search||'%' OR lower(coalesce(b.planning_data->>'Op','')) LIKE '%'||p.search||'%' OR lower(coalesce(b.planning_data->>'Subop','')) LIKE '%'||p.search||'%' OR lower(coalesce(b.pt_number,'')) LIKE '%'||p.search||'%' OR lower(coalesce(b.reported_by_name,'')) LIKE '%'||p.search||'%') pass_search,
    (jsonb_array_length(p.statuses)=0 OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(p.statuses) s WHERE s=b.status OR (s='__PENDING_REPORT__' AND b.status IN ('Sem apontamento','AGUARDANDO PRÉ-EMISSÃO DE PT','PT EM ASSINATURA','PT ENVIADA P/ CAMPO')))) pass_status,
    (jsonb_array_length(p.release_types)=0 OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(p.release_types) x WHERE x=b.release_type OR (x='__EMPTY__' AND b.release_type IS NULL))) pass_release,
    (jsonb_array_length(p.pt_colors)=0 OR p.pt_colors ? coalesce(b.effective_pt_color,'')) pass_color,
    (jsonb_array_length(p.areas)=0 OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(p.areas) x WHERE upper(btrim(x))=upper(btrim(coalesce(b.area_label,''))))) pass_area,
    (jsonb_array_length(p.locations)=0 OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(p.locations) x WHERE (x='__EMPTY__' AND b.location_label IS NULL) OR upper(btrim(x))=upper(btrim(coalesce(b.location_label,''))))) pass_location,
    (jsonb_array_length(p.work_centers)=0 OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(p.work_centers) x WHERE upper(btrim(x))=upper(btrim(coalesce(b.work_center,''))))) pass_work_center,
    (jsonb_array_length(p.planning_groups)=0 OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(p.planning_groups) x WHERE upper(btrim(x))=upper(btrim(coalesce(b.planning_group,''))))) pass_planning_group,
    (jsonb_array_length(p.gers)=0 OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(p.gers) x WHERE upper(btrim(x))=upper(btrim(b.ger_label)))) pass_ger,
    (jsonb_array_length(p.dates)=0 OR p.dates ? coalesce(b.scheduled_date::text,'')) pass_date,
    (jsonb_array_length(p.origins)=0 OR p.origins ? b.origin_label) pass_origin
  FROM base b CROSS JOIN params p
), filtered AS (
  SELECT * FROM marked WHERE pass_sap AND pass_search AND pass_status AND pass_release AND pass_color AND pass_area AND pass_location AND pass_work_center AND pass_planning_group AND pass_ger AND pass_date AND pass_origin
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
  'rows',coalesce((SELECT jsonb_agg(to_jsonb(x) - ARRAY['effective_sap_status','pass_sap','area_label','location_label','work_center','planning_group','ger_label','effective_pt_color','origin_label','planned_hours','pass_search','pass_status','pass_release','pass_color','pass_area','pass_location','pass_work_center','pass_planning_group','pass_ger','pass_date','pass_origin']::text[]) FROM (SELECT * FROM filtered ORDER BY nullif(order_number,'') NULLS LAST, nullif(planning_data->>'Op','') NULLS LAST, nullif(planning_data->>'Subop','') NULLS LAST, source_row_number NULLS LAST LIMIT greatest(1,least(p_page_size,5000)) OFFSET greatest(0,p_page)*greatest(1,least(p_page_size,5000))) x),'[]'::jsonb),
  'progress',(SELECT jsonb_build_object('hasSource',coalesce(bool_or(e.has_source),false),'invalidHours',count(*) FILTER(WHERE e.planned IS NULL),'planned',coalesce(sum(e.planned),0),'earned',coalesce(sum(e.earned),0),'percent',CASE WHEN sum(e.planned)>0 AND bool_or(e.has_source) AND count(*) FILTER(WHERE e.planned IS NULL)=0 THEN round(sum(e.earned)*100/sum(e.planned),1) END)
    FROM public.activity_sap_earned(p_week_id) e JOIN filtered f ON f.id=e.activity_id),
  'sapCounts',coalesce((SELECT jsonb_object_agg(sap_status,total) FROM
      (SELECT effective_sap_status sap_status,count(*)::integer total FROM filtered
       WHERE effective_sap_status IS NOT NULL GROUP BY effective_sap_status) counts),'{}'::jsonb),
     'totalAll',(SELECT count(*) FROM base),
  'kpis',(SELECT jsonb_build_object('total',total,'concluded',concluded,'impeded',impeded,'noReport',no_report,'cancelled',cancelled,'hours',hours,'percent',CASE WHEN total-cancelled>0 THEN round(concluded*100.0/(total-cancelled)) ELSE 0 END) FROM summary),
  'options',jsonb_build_object(
    'statuses',coalesce((SELECT jsonb_agg(DISTINCT status) FROM marked WHERE pass_sap AND pass_search AND pass_release AND pass_color AND pass_area AND pass_location AND pass_work_center AND pass_planning_group AND pass_ger AND pass_date AND pass_origin),'[]'::jsonb),
    'releaseTypes',coalesce((SELECT jsonb_agg(DISTINCT release_type) FILTER (WHERE release_type IS NOT NULL) FROM marked WHERE pass_sap AND pass_search AND pass_status AND pass_color AND pass_area AND pass_location AND pass_work_center AND pass_planning_group AND pass_ger AND pass_date AND pass_origin),'[]'::jsonb),
    'hasEmptyReleaseType',EXISTS(SELECT 1 FROM marked WHERE pass_sap AND release_type IS NULL AND pass_search AND pass_status AND pass_color AND pass_area AND pass_location AND pass_work_center AND pass_planning_group AND pass_ger AND pass_date AND pass_origin),
    'ptColors',coalesce((SELECT jsonb_agg(DISTINCT effective_pt_color) FILTER (WHERE effective_pt_color IS NOT NULL) FROM marked WHERE pass_sap AND pass_search AND pass_status AND pass_release AND pass_area AND pass_location AND pass_work_center AND pass_planning_group AND pass_ger AND pass_date AND pass_origin),'[]'::jsonb),
    'areas',coalesce((SELECT jsonb_agg(DISTINCT area_label) FILTER (WHERE area_label IS NOT NULL) FROM marked WHERE pass_sap AND pass_search AND pass_status AND pass_release AND pass_color AND pass_location AND pass_work_center AND pass_planning_group AND pass_ger AND pass_date AND pass_origin),'[]'::jsonb),
    'locations',coalesce((SELECT jsonb_agg(DISTINCT location_label) FILTER (WHERE location_label IS NOT NULL) FROM marked WHERE pass_sap AND pass_search AND pass_status AND pass_release AND pass_color AND pass_area AND pass_work_center AND pass_planning_group AND pass_ger AND pass_date AND pass_origin),'[]'::jsonb),
    'hasEmptyLocation',EXISTS(SELECT 1 FROM marked WHERE pass_sap AND location_label IS NULL AND pass_search AND pass_status AND pass_release AND pass_color AND pass_area AND pass_work_center AND pass_planning_group AND pass_ger AND pass_date AND pass_origin),
    'workCenters',coalesce((SELECT jsonb_agg(DISTINCT work_center) FILTER (WHERE work_center IS NOT NULL) FROM marked WHERE pass_sap AND pass_search AND pass_status AND pass_release AND pass_color AND pass_area AND pass_location AND pass_planning_group AND pass_ger AND pass_date AND pass_origin),'[]'::jsonb),
    'planningGroups',coalesce((SELECT jsonb_agg(DISTINCT planning_group) FILTER (WHERE planning_group IS NOT NULL) FROM marked WHERE pass_sap AND pass_search AND pass_status AND pass_release AND pass_color AND pass_area AND pass_location AND pass_work_center AND pass_ger AND pass_date AND pass_origin),'[]'::jsonb),
    'gers',coalesce((SELECT jsonb_agg(DISTINCT ger_label) FROM marked WHERE pass_sap AND pass_search AND pass_status AND pass_release AND pass_color AND pass_area AND pass_location AND pass_work_center AND pass_planning_group AND pass_date AND pass_origin),'[]'::jsonb),
    'dates',coalesce((SELECT jsonb_agg(DISTINCT scheduled_date) FILTER (WHERE scheduled_date IS NOT NULL) FROM marked WHERE pass_sap AND pass_search AND pass_status AND pass_release AND pass_color AND pass_area AND pass_location AND pass_work_center AND pass_planning_group AND pass_ger AND pass_origin),'[]'::jsonb),
    'origins',coalesce((SELECT jsonb_agg(DISTINCT origin_label) FROM marked WHERE pass_sap AND pass_search AND pass_status AND pass_release AND pass_color AND pass_area AND pass_location AND pass_work_center AND pass_planning_group AND pass_ger AND pass_date),'[]'::jsonb)
  )
);
$function$;
REVOKE ALL ON FUNCTION public.get_sap_confirmation_overview(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_sap_confirmation_overview(uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
