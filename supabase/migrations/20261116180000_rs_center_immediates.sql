CREATE OR REPLACE FUNCTION public.get_rs_center_immediate_tasks(p_sources jsonb, p_center text, p_local text DEFAULT NULL::text, p_offset integer DEFAULT 0, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE requested jsonb; chosen jsonb:='[]'; w public.weeks%ROWTYPE; closure_record public.weekly_rs_closures%ROWTYPE;
 cid uuid; sid uuid; official boolean; scope_local text:=nullif(upper(btrim(p_local)),''); result jsonb;
BEGIN
 IF NOT coalesce(public.can_access_sap(auth.uid()),false) THEN RAISE EXCEPTION 'Sem acesso às pendências do RS'; END IF;
 IF jsonb_typeof(p_sources) IS DISTINCT FROM 'array' OR jsonb_array_length(p_sources) NOT BETWEEN 1 AND 12
 OR p_center IS NULL OR btrim(p_center)='' OR length(p_center)>160
 OR (scope_local IS NOT NULL AND scope_local NOT IN ('IARI','ROTINA'))
 OR p_offset IS NULL OR p_offset<0 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Filtros inválidos'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_sources) s GROUP BY s->>'week_id' HAVING count(*)>1) THEN RAISE EXCEPTION 'Semana duplicada'; END IF;
 FOR requested IN SELECT * FROM jsonb_array_elements(p_sources) LOOP
  SELECT * INTO w FROM public.weeks WHERE id=(requested->>'week_id')::uuid;
  IF NOT FOUND OR NOT coalesce(public.can_access_worksite(auth.uid(),w.worksite_id),false) THEN RAISE EXCEPTION 'Sem acesso à semana solicitada'; END IF;
  cid:=nullif(requested->>'closure_id','')::uuid;
  IF cid IS NULL AND w.sap_closure_status='closed' THEN
   SELECT id INTO cid FROM public.weekly_rs_closures WHERE week_id=w.id AND worksite_id=w.worksite_id ORDER BY version DESC LIMIT 1;
   IF cid IS NULL THEN RAISE EXCEPTION 'Semana fechada sem memória preservada para este detalhamento'; END IF;
  END IF;
  IF cid IS NOT NULL THEN
   SELECT * INTO closure_record FROM public.weekly_rs_closures WHERE id=cid AND week_id=w.id AND worksite_id=w.worksite_id;
   IF NOT FOUND THEN RAISE EXCEPTION 'Fechamento não corresponde à semana solicitada'; END IF;
   SELECT nullif(payload->>'id','')::uuid INTO sid FROM public.weekly_rs_closure_items WHERE closure_id=cid AND kind='sap_import' LIMIT 1;
   official:=EXISTS(SELECT 1 FROM public.weekly_rs_closure_items WHERE closure_id=cid AND kind='program_basis')
    OR EXISTS(SELECT 1 FROM public.weekly_rs_closure_scopes WHERE closure_id=cid AND data->'programBasis'->>'kind'='official');
  ELSE
   SELECT i.id INTO sid FROM public.sap_confirmation_imports i WHERE week_id=w.id AND worksite_id=w.worksite_id
    AND EXISTS(SELECT 1 FROM public.sap_confirmation_rows r WHERE r.import_id=i.id AND r.worksite_id=w.worksite_id)
    ORDER BY imported_at DESC,id DESC LIMIT 1;
   official:=EXISTS(SELECT 1 FROM public.weekly_rs_program_bases WHERE week_id=w.id AND worksite_id=w.worksite_id);
  END IF;
  chosen:=chosen||jsonb_build_array(jsonb_build_object('week_id',w.id,'week_code',w.code,'closure_id',cid,'source_id',sid,'official',official));
 END LOOP;
 WITH sources AS MATERIALIZED (
 SELECT * FROM jsonb_to_recordset(chosen) s(week_id uuid,week_code text,closure_id uuid,source_id uuid,official boolean)
 ), sap AS MATERIALIZED (
 SELECT s.*,to_jsonb(r) payload FROM sources s JOIN public.sap_confirmation_rows r ON s.closure_id IS NULL AND r.import_id=s.source_id AND r.week_id=s.week_id
 UNION ALL
 SELECT s.*,i.payload FROM sources s JOIN public.weekly_rs_closure_items i ON i.closure_id=s.closure_id AND i.kind='sap'
 ), available AS MATERIALIZED (
 SELECT s.week_id,r FROM sources s JOIN public.weekly_rs_availability a ON a.week_id=s.week_id AND s.closure_id IS NULL CROSS JOIN LATERAL jsonb_array_elements(a.rows) r
 UNION ALL
 SELECT s.week_id,r FROM sources s JOIN public.weekly_rs_closure_scopes c ON c.closure_id=s.closure_id AND c.scope='ALL' CROSS JOIN LATERAL jsonb_array_elements(coalesce(c.data->'availability'->'rows','[]')) r
 ), program AS MATERIALIZED (
 SELECT s.week_id,public.normalize_sap_identifier(r->>'confirmation') confirmation FROM sources s JOIN public.weekly_rs_program_bases b ON b.week_id=s.week_id AND s.closure_id IS NULL CROSS JOIN LATERAL jsonb_array_elements(b.rows) r
 UNION
 SELECT s.week_id,public.normalize_sap_identifier(r->>'confirmation') FROM sources s JOIN public.weekly_rs_closure_items i ON i.closure_id=s.closure_id AND i.kind='program_basis' CROSS JOIN LATERAL jsonb_array_elements(coalesce(i.payload->'rows','[]')) r
 ), operational AS MATERIALIZED (
 SELECT s.week_id,to_jsonb(e) payload FROM sources s CROSS JOIN LATERAL public.weekly_rs_activity_evidence(s.week_id) e WHERE s.closure_id IS NULL AND NOT s.official
 UNION ALL
 SELECT s.week_id,i.evidence FROM sources s JOIN public.weekly_rs_closure_items i ON i.closure_id=s.closure_id AND i.kind='activity' WHERE NOT s.official
 ), classified AS MATERIALIZED (
 SELECT s.*,public.rs_program_center(s.payload->>'work_center') center,
 public.rs_center_local(s.payload->>'work_center',coalesce(m.local,'SEM LOCAL')) local
 FROM sap s LEFT JOIN LATERAL (SELECT CASE WHEN count(DISTINCT upper(btrim(r->>'local')))=1 THEN min(upper(btrim(r->>'local'))) END local FROM available a WHERE a.week_id=s.week_id AND public.rs_program_center(a.r->>'center')=public.rs_program_center(s.payload->>'work_center')) m ON true
 WHERE (s.payload->>'has_confirmation')::boolean AND (s.payload->>'actual_work')::numeric>0
 AND public.normalize_sap_identifier(s.payload->>'planning_code')='2'
 AND CASE WHEN s.official THEN NOT EXISTS(SELECT 1 FROM program p WHERE p.week_id=s.week_id AND p.confirmation=public.normalize_sap_identifier(s.payload->>'confirmation'))
 ELSE NOT EXISTS(SELECT 1 FROM operational o WHERE o.week_id=s.week_id AND public.normalize_sap_identifier(o.payload->>'confirmation')=public.normalize_sap_identifier(s.payload->>'confirmation')
 AND (o.payload->>'scheduled_date')::date BETWEEN coalesce((s.payload->>'actual_start_date')::date,(s.payload->>'actual_end_date')::date,(o.payload->>'scheduled_date')::date) AND coalesce((s.payload->>'actual_end_date')::date,(s.payload->>'actual_start_date')::date,(o.payload->>'scheduled_date')::date)) END
 ), filtered AS MATERIALIZED (SELECT * FROM classified WHERE center=public.rs_program_center(p_center) AND (scope_local IS NULL OR local=scope_local)),
 page AS (SELECT payload||jsonb_build_object('week_code',week_code,'week_id',week_id,'local',local) row FROM filtered ORDER BY week_code,payload->>'order_number',payload->>'operation',payload->>'id' LIMIT p_limit OFFSET p_offset)
 SELECT jsonb_build_object('total',(SELECT count(*) FROM filtered),'totalHh',(SELECT coalesce(sum((payload->>'actual_work')::numeric),0) FROM filtered),
 'rows',coalesce((SELECT jsonb_agg(row) FROM page),'[]'),'missingSapWeeks',coalesce((SELECT jsonb_agg(week_code) FROM sources WHERE source_id IS NULL),'[]')) INTO result;
 RETURN result;
END $function$;
REVOKE ALL ON FUNCTION public.get_rs_center_immediate_tasks(jsonb,text,text,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_rs_center_immediate_tasks(jsonb,text,text,integer,integer) TO authenticated;
