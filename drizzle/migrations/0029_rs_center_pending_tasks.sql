-- On-demand, read-only detail. No RS calculation or operational record is changed.
CREATE FUNCTION public.get_rs_center_pending_tasks(
 p_sources jsonb,p_center text,p_local text DEFAULT NULL,p_offset integer DEFAULT 0,p_limit integer DEFAULT 50
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
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
 ), confirmed AS MATERIALIZED (
  SELECT s.week_id,public.normalize_sap_identifier(r.confirmation) confirmation FROM sources s
   JOIN public.sap_confirmation_rows r ON s.closure_id IS NULL AND r.import_id=s.source_id AND r.week_id=s.week_id
   WHERE r.has_confirmation AND r.actual_work>0
  UNION
  SELECT s.week_id,public.normalize_sap_identifier(i.payload->>'confirmation') FROM sources s
   JOIN public.weekly_rs_closure_items i ON i.closure_id=s.closure_id AND i.kind='sap'
   WHERE (i.payload->>'has_confirmation')::boolean AND (i.payload->>'actual_work')::numeric>0
 ), evidence AS MATERIALIZED (
  SELECT s.week_id,s.week_code,s.closure_id,s.official,to_jsonb(e) payload FROM sources s
   CROSS JOIN LATERAL public.weekly_rs_activity_evidence(s.week_id) e
   WHERE s.closure_id IS NULL AND s.source_id IS NOT NULL
    AND public.rs_program_center(e.center)=public.rs_program_center(p_center)
    AND (scope_local IS NULL OR e.local=scope_local)
  UNION ALL
  SELECT s.week_id,s.week_code,s.closure_id,s.official,i.evidence FROM sources s JOIN public.weekly_rs_closure_items i ON i.closure_id=s.closure_id
   WHERE s.source_id IS NOT NULL AND i.kind='activity'
    AND public.rs_program_center(i.evidence->>'center')=public.rs_program_center(p_center)
    AND (scope_local IS NULL OR i.evidence->>'local'=scope_local)
 ), pending AS MATERIALIZED (
  -- Official RS is weekly by confirmation, without applying operational day filters.
  -- Partial positive appropriations are excluded too: this detail is ONLY zero appropriation.
  SELECT * FROM evidence e WHERE CASE WHEN e.official THEN NOT EXISTS(
   SELECT 1 FROM confirmed c WHERE c.week_id=e.week_id AND c.confirmation=public.normalize_sap_identifier(e.payload->>'confirmation')
  ) ELSE e.payload->>'sap_state' IN ('sem_apropriacao','sem_confirmacao') END
 ), page AS (
  SELECT * FROM pending ORDER BY payload->>'scheduled_date',week_code,payload->>'order_number',payload->>'operation',payload->>'id'
   LIMIT p_limit OFFSET p_offset
 ), details AS (
  SELECT p.payload||jsonb_build_object('week_id',p.week_id,'week_code',p.week_code,'closure_id',p.closure_id,
   'justification_by',CASE WHEN p.closure_id IS NOT NULL THEN p.payload->>'justification_by' ELSE audit.changed_by_name END,
   'justification_at',CASE WHEN p.closure_id IS NOT NULL THEN p.payload->>'justification_at' ELSE audit.changed_at::text END) row
  FROM page p LEFT JOIN LATERAL (
   SELECT h.changed_by_name,h.changed_at FROM public.activity_history h
   WHERE p.closure_id IS NULL AND nullif(btrim(p.payload->>'justification'),'') IS NOT NULL
    AND h.activity_id=(p.payload->>'id')::uuid AND h.week_id=p.week_id
    AND h.new_values->>'justification'=p.payload->>'justification'
    AND h.previous_values->>'justification' IS DISTINCT FROM h.new_values->>'justification'
   ORDER BY h.changed_at DESC,h.id DESC LIMIT 1
  ) audit ON true
 ) SELECT jsonb_build_object('total',(SELECT count(*) FROM pending),
  'rows',coalesce((SELECT jsonb_agg(row ORDER BY row->>'scheduled_date',row->>'week_code',row->>'order_number',row->>'operation',row->>'id') FROM details),'[]'),
  'sources',chosen,'missingSapWeeks',coalesce((SELECT jsonb_agg(week_code) FROM sources WHERE source_id IS NULL),'[]'),
  'unknownPeriod',(SELECT count(*) FROM evidence ev WHERE NOT ev.official AND ev.payload->>'sap_state'='periodo_indefinido')
 ) INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.get_rs_center_pending_tasks(jsonb,text,text,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_rs_center_pending_tasks(jsonb,text,text,integer,integer) TO authenticated;
NOTIFY pgrst,'reload schema';
