-- Database-owner integration test. Every change is rolled back.
-- Configure request.jwt.claim.sub to an authorized administrator before executing.
BEGIN;
DO $test$
DECLARE w uuid; cid uuid; before_count int; version_number int; frozen jsonb; blocked boolean:=false;
BEGIN
 SELECT a.week_id INTO w FROM public.weekly_rs_availability a JOIN public.weeks w ON w.id=a.week_id
 WHERE public.can_access_worksite(auth.uid(),w.worksite_id)
 AND public.rs_archive_calculation(public.get_weekly_rs_analysis(w.id,NULL),NULL)->'result'<>'null'::jsonb
 ORDER BY w.start_date DESC LIMIT 1;
 IF w IS NULL THEN RAISE EXCEPTION 'Test requires a week with valid SAP and availability'; END IF;
 SELECT count(*) INTO before_count FROM public.weekly_rs_closures WHERE week_id=w;
 IF (SELECT sap_closure_status FROM public.weeks WHERE id=w)='closed' THEN
   PERFORM public.reopen_sap_week(w,'Rollback test: open before closing');
 END IF;
 PERFORM public.close_sap_week(w,'Rollback test: first version');
 SELECT id,version INTO cid,version_number FROM public.weekly_rs_closures WHERE week_id=w ORDER BY version DESC LIMIT 1;
 frozen:=public.get_weekly_rs_report(w,NULL,version_number);
 IF NOT (frozen->>'isFrozen')::boolean THEN RAISE EXCEPTION 'Report is not frozen'; END IF;
 IF (public.get_weekly_rs_closure_items(cid,'activity',0,50)->>'total')::int<>(SELECT count(*) FROM public.activities WHERE week_id=w) THEN RAISE EXCEPTION 'Lost activities'; END IF;
 PERFORM public.get_weekly_rs_closure_pending(cid,NULL,0,50,NULL,false,true,'');
 PERFORM public.close_sap_week(w,'Rollback test: idempotence');
 IF (SELECT count(*) FROM public.weekly_rs_closures WHERE week_id=w)<>before_count+1 THEN RAISE EXCEPTION 'Duplicate closure'; END IF;
 BEGIN UPDATE public.weekly_rs_closures SET reason='Forbidden' WHERE id=cid; EXCEPTION WHEN OTHERS THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'Mutable archive'; END IF;
 blocked:=false;
 BEGIN UPDATE public.weekly_rs_availability SET version=version+1 WHERE week_id=w; EXCEPTION WHEN OTHERS THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'Mutable closed availability'; END IF;
 PERFORM public.reopen_sap_week(w,'Rollback test: reopen');
 UPDATE public.weekly_rs_availability SET rows=(SELECT jsonb_agg(r||jsonb_build_object('hours',(r->>'hours')::numeric*2)) FROM jsonb_array_elements(rows) r) WHERE week_id=w;
 IF public.get_weekly_rs_report(w,NULL,version_number)<>frozen THEN RAISE EXCEPTION 'Prior version changed'; END IF;
 PERFORM public.close_sap_week(w,'Rollback test: second version');
 IF (SELECT count(*) FROM public.weekly_rs_closures WHERE week_id=w)<>before_count+2 THEN RAISE EXCEPTION 'Second version missing'; END IF;
 IF public.get_weekly_rs_report(w,NULL,version_number+1)->'frozenCalculation'->'result'=frozen->'frozenCalculation'->'result' THEN RAISE EXCEPTION 'New base not applied'; END IF;
END $test$;
ROLLBACK;
