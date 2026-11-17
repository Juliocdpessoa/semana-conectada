BEGIN;

SELECT set_config('request.jwt.claim.sub','b8b97321-11db-430e-b6b5-40b3cb15f307',true);
DO $test$ DECLARE r jsonb; eid uuid; n int; BEGIN
 r:=public.import_continuous_activities('68166d78-53b7-4c66-bea9-deb94e39a2c3','[{"key":"fixture","data":{"ss":"TEST","os":"1","description":"Teste transacional","status":"1","value":100}}]');
 IF (r->>'inserted')::int<>1 THEN RAISE EXCEPTION 'Insert failed'; END IF;
 r:=public.import_continuous_activities('68166d78-53b7-4c66-bea9-deb94e39a2c3','[{"key":"fixture","data":{"ss":"TEST","os":"1","description":"Teste transacional","status":"1","value":999}}]');
 IF (r->>'skipped')::int<>1 THEN RAISE EXCEPTION 'Duplicate not skipped'; END IF;
 SELECT id INTO eid FROM public.continuous_activities WHERE data->>'ss'='TEST';
 PERFORM public.save_continuous_activity('68166d78-53b7-4c66-bea9-deb94e39a2c3','fixture','{"ss":"TEST","os":"1","description":"Teste transacional","status":"4","value":100}',eid,1);
 SELECT count(*) INTO n FROM public.continuous_activity_history WHERE record_id=eid;
 IF n<>2 THEN RAISE EXCEPTION 'Audit not complete'; END IF;
 BEGIN
 PERFORM public.save_continuous_activity('68166d78-53b7-4c66-bea9-deb94e39a2c3','fixture','{"description":"Conflict","status":"4"}',eid,1);
 RAISE EXCEPTION 'Expected version conflict';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
 IF EXISTS(SELECT 1 FROM public.activity_page_configs WHERE worksite_id='52504243-0000-4000-8000-000000000001') THEN RAISE EXCEPTION 'RPBC changed'; END IF;
 IF has_table_privilege('authenticated','public.continuous_activities','UPDATE') OR has_function_privilege('anon','public.save_continuous_activity(uuid,text,jsonb,uuid,integer)','EXECUTE') THEN RAISE EXCEPTION 'ACL exposed'; END IF;
END $test$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000000',true);
DO $test$ BEGIN
 BEGIN
 PERFORM public.import_continuous_activities('68166d78-53b7-4c66-bea9-deb94e39a2c3','[{"key":"bad","data":{"description":"bad","status":"1"}}]');
 RAISE EXCEPTION 'Access bypass';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Access bypass' THEN RAISE; END IF; END;
END $test$;
SELECT 'insert, duplicate preservation, update, audit, version conflict, permissions and RPBC isolation passed' AS result;

ROLLBACK;
