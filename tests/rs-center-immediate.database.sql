-- Read-only regression checks; no business rows are changed.
BEGIN;
SELECT set_config('request.jwt.claim.sub','b8b97321-11db-430e-b6b5-40b3cb15f307',true);
DO $test$ DECLARE r jsonb; BEGIN
r:=public.get_rs_center_immediate_tasks('[{"week_id":"c31084b0-6e84-40d6-8003-368a3aa9c3c6"}]','ANDA_MEC','ROTINA',0,1);
IF (r->>'totalHh')::numeric<>24.2 OR jsonb_array_length(r->'rows')>1 THEN RAISE EXCEPTION 'Live HH/pagination mismatch'; END IF;
r:=public.get_rs_center_immediate_tasks('[{"week_id":"c31084b0-6e84-40d6-8003-368a3aa9c3c6"}]','ANDA_MEC','IARI',0,50);
IF (r->>'totalHh')::numeric<>0 THEN RAISE EXCEPTION 'Local mismatch'; END IF;
r:=public.get_rs_center_immediate_tasks('[{"week_id":"168b19ec-f72c-4813-9cc1-c575f5160a36","closure_id":"cf39f747-3dbe-4236-a7d0-3d62cf2f211b"}]','ANDA_INS','ROTINA',0,50);
IF (r->>'totalHh')::numeric<>18.5 THEN RAISE EXCEPTION 'Frozen HH mismatch'; END IF;
END $test$;
ROLLBACK;
