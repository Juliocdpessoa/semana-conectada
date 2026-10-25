-- Read-only consolidation inputs. Weekly sources, closures and operational data remain unchanged.
CREATE FUNCTION public.get_monthly_rs_weeks(p_worksite_id uuid,p_week_ids uuid[],p_local text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE w public.weeks%ROWTYPE; d jsonb; calc jsonb; items jsonb:='[]'; issues jsonb; selected_local text:=nullif(upper(btrim(p_local)),'');
BEGIN
 IF NOT coalesce(public.can_access_sap(auth.uid()),false) OR NOT coalesce(public.can_access_worksite(auth.uid(),p_worksite_id),false) THEN RAISE EXCEPTION 'Sem acesso ao RS desta obra'; END IF;
 IF selected_local IS NOT NULL AND selected_local NOT IN ('IARI','ROTINA') THEN RAISE EXCEPTION 'Local inválido'; END IF;
 IF p_week_ids IS NULL OR cardinality(p_week_ids) NOT BETWEEN 1 AND 12 OR array_position(p_week_ids,NULL) IS NOT NULL OR (SELECT count(DISTINCT x) FROM unnest(p_week_ids) x)<>cardinality(p_week_ids) THEN RAISE EXCEPTION 'Selecione entre 1 e 12 semanas distintas'; END IF;
 IF (SELECT count(*) FROM public.weeks WHERE id=ANY(p_week_ids) AND worksite_id=p_worksite_id)<>cardinality(p_week_ids) THEN RAISE EXCEPTION 'Semana inexistente ou pertencente a outra obra'; END IF;
 FOR w IN SELECT * FROM public.weeks WHERE id=ANY(p_week_ids) AND worksite_id=p_worksite_id ORDER BY start_date,id LOOP
  d:=public.get_weekly_rs_report(w.id,selected_local,NULL);
  calc:=CASE WHEN coalesce((d->>'isFrozen')::boolean,false) THEN d->'frozenCalculation' ELSE public.rs_archive_calculation(d,selected_local) END;
  issues:='[]';
  IF d->'source' IS NULL OR d->'source'='null'::jsonb THEN issues:=issues||jsonb_build_array('Sem carga SAP detalhada'); END IF;
  IF d->'availability' IS NULL OR d->'availability'='null'::jsonb THEN issues:=issues||jsonb_build_array('Sem disponibilidade HH'); END IF;
  IF coalesce((d->>'unresolvedLocal')::int,0)>0 THEN issues:=issues||jsonb_build_array('Vínculos de local pendentes'); END IF;
  IF coalesce((d->>'invalidPlannedHours')::int,0)>0 OR jsonb_array_length(coalesce(calc->'invalid','[]'))>0 THEN issues:=issues||jsonb_build_array('HH inválidos'); END IF;
  IF jsonb_array_length(coalesce(calc->'unmapped','[]'))>0 THEN issues:=issues||jsonb_build_array('Centros sem disponibilidade vinculada'); END IF;
  IF coalesce((d->>'legacyClosedWithoutSnapshot')::boolean,false) THEN issues:=issues||jsonb_build_array('Semana fechada sem versão oficial preservada'); END IF;
  IF (calc->'result' IS NULL OR calc->'result'='null'::jsonb) AND jsonb_array_length(issues)=0 THEN issues:=issues||jsonb_build_array('Sem base válida para calcular RS'); END IF;
  items:=items||jsonb_build_array(jsonb_build_object(
   'week',jsonb_build_object('id',w.id,'code',w.code,'label',w.label,'start_date',w.start_date,'end_date',w.end_date),
   'isFrozen',coalesce((d->>'isFrozen')::boolean,false),
   'closure',CASE WHEN d->'closure'<>'null'::jsonb THEN jsonb_build_object('id',d->'closure'->'id','version',d->'closure'->'version','rule_version',d->'closure'->'rule_version') END,
   'basis',d->'programBasis','source',d->'source','valid',jsonb_array_length(issues)=0,'issues',issues,
   'calculation',jsonb_build_object('result',calc->'result','totals',calc->'totals','rows',coalesce(calc->'rows','[]'),'centerRows',coalesce(calc->'centerRows','[]'))));
 END LOOP;
 RETURN jsonb_build_object('weeks',items,'local',selected_local,'datePolicy','selected-whole-weeks','capPolicy','sum-weekly-capped-values');
END $$;
REVOKE ALL ON FUNCTION public.get_monthly_rs_weeks(uuid,uuid[],text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_monthly_rs_weeks(uuid,uuid[],text) TO authenticated;
NOTIFY pgrst,'reload schema';
