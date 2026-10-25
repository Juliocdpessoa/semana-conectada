-- Execute after the migration and official week-43 fixture inside BEGIN / ROLLBACK.
DO $test$
DECLARE d jsonb; calc jsonb; cid uuid; before_scope jsonb; message text;
BEGIN
 d:=public.get_weekly_rs_analysis('c4112977-cc67-47f4-b609-7ce06240c61a',NULL);
 calc:=public.rs_archive_calculation(d,NULL);
 IF d->'programBasis'->>'kind' IS DISTINCT FROM 'official' OR (d->>'unresolvedLocal')::int IS DISTINCT FROM 0 OR calc->'result'->>'rs' IS NULL THEN RAISE EXCEPTION 'Invalid official result'; END IF;
 IF abs((calc->'result'->>'rs')::numeric-78.45333869670152)>0.0000001 THEN RAISE EXCEPTION 'RS differs from independent calculation'; END IF;
 IF (calc->'totals'->>'programmed')::numeric IS DISTINCT FROM 15684.1 THEN RAISE EXCEPTION 'Wrong weekly official HH'; END IF;
 BEGIN
  PERFORM public.save_weekly_rs_program_base('c4112977-cc67-47f4-b609-7ce06240c61a',(SELECT rows FROM public.weekly_rs_program_bases WHERE week_id='c4112977-cc67-47f4-b609-7ce06240c61a'),'stale.xlsx','Programação SAP',0);
  RAISE EXCEPTION 'Expected version conflict';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
 BEGIN
  PERFORM public.save_weekly_rs_program_base('c4112977-cc67-47f4-b609-7ce06240c61a','[{"confirmation":"1","order_number":"1","operation":"1","center":"CALD","work":8.8,"source_row_number":2,"source_data":{}},{"confirmation":"001","order_number":"1","operation":"1","center":"CALD","work":8.8,"source_row_number":3,"source_data":{}}]','duplicate.xlsx','Programação SAP',1);
  RAISE EXCEPTION 'Expected duplicate rejection';
 EXCEPTION WHEN raise_exception THEN GET STACKED DIAGNOSTICS message=MESSAGE_TEXT; IF message NOT LIKE 'Confirmação duplicada%' THEN RAISE; END IF; END;
 cid:=public.capture_weekly_rs_closure('c4112977-cc67-47f4-b609-7ce06240c61a','Transactional regression, never committed');
 IF (public.get_weekly_rs_closure_items(cid,'program_basis',0,500)->>'total')::int IS DISTINCT FROM 1 OR (public.get_weekly_rs_closure_items(cid,'program_basis_history',0,500)->>'total')::int IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'Official source not archived'; END IF;
 SELECT data INTO before_scope FROM public.weekly_rs_closure_scopes WHERE closure_id=cid AND scope='ALL';
 IF before_scope->'programBasis'->>'kind' IS DISTINCT FROM 'official' THEN RAISE EXCEPTION 'Frozen basis missing'; END IF;
 -- Updating an OPEN source after capture must not change the previous immutable version.
 PERFORM public.save_weekly_rs_program_base('c4112977-cc67-47f4-b609-7ce06240c61a',(SELECT rows FROM public.weekly_rs_program_bases WHERE week_id='c4112977-cc67-47f4-b609-7ce06240c61a'),'version2.xlsx','Programação SAP',1);
 IF before_scope IS DISTINCT FROM (SELECT data FROM public.weekly_rs_closure_scopes WHERE closure_id=cid AND scope='ALL') THEN RAISE EXCEPTION 'Frozen scope changed'; END IF;
 IF (SELECT count(*) FROM public.weekly_rs_program_base_history WHERE week_id='c4112977-cc67-47f4-b609-7ce06240c61a')<>2 THEN RAISE EXCEPTION 'Source history missing'; END IF;
 BEGIN UPDATE public.weekly_rs_program_base_history SET source_file_name='overwrite' WHERE week_id='c4112977-cc67-47f4-b609-7ce06240c61a'; RAISE EXCEPTION 'History accepted mutation';
 EXCEPTION WHEN raise_exception THEN GET STACKED DIAGNOSTICS message=MESSAGE_TEXT; IF message='History accepted mutation' THEN RAISE; END IF; END;
 UPDATE public.weeks SET sap_closure_status='closed' WHERE id='c4112977-cc67-47f4-b609-7ce06240c61a';
 BEGIN
  PERFORM public.save_weekly_rs_program_base('c4112977-cc67-47f4-b609-7ce06240c61a',(SELECT rows FROM public.weekly_rs_program_bases WHERE week_id='c4112977-cc67-47f4-b609-7ce06240c61a'),'closed.xlsx','Programação SAP',2);
  RAISE EXCEPTION 'Closed week accepted write';
 EXCEPTION WHEN raise_exception THEN GET STACKED DIAGNOSTICS message=MESSAGE_TEXT; IF message NOT LIKE 'Semana fechada.%' THEN RAISE; END IF; END;
 PERFORM set_config('request.jwt.claim.sub','',true);
 BEGIN PERFORM public.get_weekly_rs_official_analysis('c4112977-cc67-47f4-b609-7ce06240c61a',NULL); RAISE EXCEPTION 'Anonymous accepted';
 EXCEPTION WHEN raise_exception THEN GET STACKED DIAGNOSTICS message=MESSAGE_TEXT; IF message NOT LIKE 'Sem acesso%' THEN RAISE; END IF; END;
 PERFORM set_config('request.jwt.claim.sub','b8b97321-11db-430e-b6b5-40b3cb15f307',true);
END $test$;
