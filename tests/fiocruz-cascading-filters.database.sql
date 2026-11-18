BEGIN;
SELECT set_config('request.jwt.claim.sub','b8b97321-11db-430e-b6b5-40b3cb15f307',true);
SELECT public.import_continuous_activities('68166d78-53b7-4c66-bea9-deb94e39a2c3','[
{"key":"cascade-a","data":{"description":"CascadeFixture","status":"1","local":"IARI","sector":"ELÉTRICA","requester":"Ana","requested_date":"2026-11-01"}},
{"key":"cascade-b","data":{"description":"CascadeFixture","status":"4","local":"ROTINA","sector":"CIVIL","requester":"Bruno","requested_date":"2026-11-02"}},
{"key":"cascade-c","data":{"description":"CascadeFixture","status":"1","local":"ROTINA","sector":"CIVIL","requester":"Ana","requested_date":"2026-11-03"}},
{"key":"cascade-d","data":{"description":"CascadeFixture","status":"6","local":"IARI","sector":"CIVIL","requester":"Carla","requested_date":"2026-11-04"}}
]');
DO $test$ DECLARE f jsonb;c jsonb;
BEGIN
 f:=public.continuous_activity_facets('68166d78-53b7-4c66-bea9-deb94e39a2c3','CascadeFixture','{"status":["1","4"],"local":["IARI","ROTINA"]}',NULL,NULL);
 IF f->'requester'<>'["Ana","Bruno"]'::jsonb THEN RAISE EXCEPTION 'OR selections / chained options failed'; END IF;
 f:=public.continuous_activity_facets('68166d78-53b7-4c66-bea9-deb94e39a2c3','CascadeFixture','{"status":["1"],"sector":["CIVIL"]}',NULL,NULL);
 IF f->'local'<>'["ROTINA"]'::jsonb THEN RAISE EXCEPTION 'AND between fields failed'; END IF;
 f:=public.continuous_activity_facets('68166d78-53b7-4c66-bea9-deb94e39a2c3','CascadeFixture','{}','2026-11-02','2026-11-02');
 IF f->'requester'<>'["Bruno"]'::jsonb THEN RAISE EXCEPTION 'Date scoping failed'; END IF;
 c:=public.continuous_activity_status_counts('68166d78-53b7-4c66-bea9-deb94e39a2c3','CascadeFixture','{"sector":["CIVIL"],"local":["IARI","ROTINA"]}',NULL,NULL);
 IF c<>'{"1":1,"4":1,"6":1}'::jsonb THEN RAISE EXCEPTION 'Cards array counts failed'; END IF;
 c:=public.continuous_activity_status_counts('68166d78-53b7-4c66-bea9-deb94e39a2c3','CascadeFixture','{"local":"IARI"}',NULL,NULL);
 IF c<>'{"1":1,"6":1}'::jsonb THEN RAISE EXCEPTION 'Legacy compatibility failed'; END IF;
 IF has_function_privilege('anon','public.continuous_activity_facets(uuid,text,jsonb,date,date)','EXECUTE') THEN RAISE EXCEPTION 'Anonymous metadata exposed'; END IF;
END $test$;
SELECT 'multi-select, cascading, dates, counters and legacy compatibility passed' result;
ROLLBACK;
