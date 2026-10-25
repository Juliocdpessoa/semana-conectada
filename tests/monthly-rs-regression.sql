-- Run after monthly migration in a transaction and ROLLBACK. Never commit test closures.
DO $test$
DECLARE report jsonb; message text; original jsonb; cid uuid;
BEGIN
 PERFORM set_config('request.jwt.claim.sub','b8b97321-11db-430e-b6b5-40b3cb15f307',true);
 report:=public.get_monthly_rs_weeks('52504243-0000-4000-8000-000000000001',ARRAY['eea7fc13-1bfd-4117-b315-257fd1db1ea5'::uuid,'c4112977-cc67-47f4-b609-7ce06240c61a'::uuid],NULL);
 IF jsonb_array_length(report->'weeks')<>2 OR NOT (report->'weeks'->0->>'valid')::boolean OR NOT (report->'weeks'->1->>'valid')::boolean THEN RAISE EXCEPTION 'Two-week source not complete'; END IF;
 IF abs((SELECT sum((r->'calculation'->'totals'->>'considered')::numeric) FROM jsonb_array_elements(report->'weeks') r)-23126.5)>0.0000001 THEN RAISE EXCEPTION 'Wrong weekly capped numerator'; END IF;
 IF abs((SELECT sum((r->'calculation'->'totals'->>'available')::numeric) FROM jsonb_array_elements(report->'weeks') r)-27024.8)>0.0000001 THEN RAISE EXCEPTION 'Wrong monthly denominator'; END IF;
 report:=public.get_monthly_rs_weeks('52504243-0000-4000-8000-000000000001',ARRAY['59b5ee9b-9142-4e9a-a4b7-5b10978e445b'::uuid],NULL);
 IF (report->'weeks'->0->>'valid')::boolean OR report->'weeks'->0->'calculation'->'result'<>'null'::jsonb THEN RAISE EXCEPTION 'Missing SAP became measured zero'; END IF;
 BEGIN PERFORM public.get_monthly_rs_weeks('52504243-0000-4000-8000-000000000001',ARRAY['c4112977-cc67-47f4-b609-7ce06240c61a'::uuid,'c4112977-cc67-47f4-b609-7ce06240c61a'::uuid],NULL); RAISE EXCEPTION 'Duplicates accepted';
 EXCEPTION WHEN raise_exception THEN GET STACKED DIAGNOSTICS message=MESSAGE_TEXT; IF message NOT LIKE 'Selecione entre%' THEN RAISE; END IF; END;
 BEGIN PERFORM public.get_monthly_rs_weeks('52504243-0000-4000-8000-000000000001',ARRAY['00000000-0000-4000-8000-000000000000'::uuid],NULL); RAISE EXCEPTION 'Unknown week accepted';
 EXCEPTION WHEN raise_exception THEN GET STACKED DIAGNOSTICS message=MESSAGE_TEXT; IF message NOT LIKE 'Semana inexistente%' THEN RAISE; END IF; END;
 BEGIN PERFORM public.get_monthly_rs_weeks('52504243-0000-4000-8000-000000000001',ARRAY['c4112977-cc67-47f4-b609-7ce06240c61a'::uuid],'INVALID'); RAISE EXCEPTION 'Invalid local accepted';
 EXCEPTION WHEN raise_exception THEN GET STACKED DIAGNOSTICS message=MESSAGE_TEXT; IF message<>'Local inválido' THEN RAISE; END IF; END;
 PERFORM set_config('request.jwt.claim.sub','',true);
 BEGIN PERFORM public.get_monthly_rs_weeks('52504243-0000-4000-8000-000000000001',ARRAY['c4112977-cc67-47f4-b609-7ce06240c61a'::uuid],NULL); RAISE EXCEPTION 'Anonymous accepted';
 EXCEPTION WHEN raise_exception THEN GET STACKED DIAGNOSTICS message=MESSAGE_TEXT; IF message NOT LIKE 'Sem acesso%' THEN RAISE; END IF; END;
 PERFORM set_config('request.jwt.claim.sub','b8b97321-11db-430e-b6b5-40b3cb15f307',true);
 original:=public.get_weekly_rs_report('c4112977-cc67-47f4-b609-7ce06240c61a',NULL,NULL);
 PERFORM public.close_sap_week('c4112977-cc67-47f4-b609-7ce06240c61a','Transactional monthly test; rollback required');
 report:=public.get_monthly_rs_weeks('52504243-0000-4000-8000-000000000001',ARRAY['c4112977-cc67-47f4-b609-7ce06240c61a'::uuid],NULL);
 IF NOT (report->'weeks'->0->>'isFrozen')::boolean OR report->'weeks'->0->'closure'->>'id' IS NULL THEN RAISE EXCEPTION 'Monthly read lost frozen source'; END IF;
 SELECT id INTO cid FROM public.weekly_rs_closures WHERE week_id='c4112977-cc67-47f4-b609-7ce06240c61a' ORDER BY version DESC LIMIT 1;
 IF report->'weeks'->0->'calculation'->'result' IS DISTINCT FROM (SELECT data->'frozenCalculation'->'result' FROM public.weekly_rs_closure_scopes WHERE closure_id=cid AND scope='ALL') THEN RAISE EXCEPTION 'Frozen monthly source was recomputed'; END IF;
END $test$;
