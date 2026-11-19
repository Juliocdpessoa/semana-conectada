DO $check$
DECLARE n integer;
BEGIN
 SELECT count(*) INTO n FROM pg_proc WHERE pronamespace='public'::regnamespace AND prokind='f' AND prosrc LIKE '%40001%';
 IF n<>0 THEN RAISE EXCEPTION 'Retryable business conflicts remain'; END IF;
 SELECT count(*) INTO n FROM pg_proc WHERE pronamespace='public'::regnamespace
 AND proname IN ('patch_activity_planning_fields','save_weekly_rs_availability','save_weekly_rs_program_base','save_continuous_activity','decide_overtime_batch')
 AND prosrc LIKE '%PT409%';
 IF n<>5 THEN RAISE EXCEPTION 'Expected five non-retryable conflict handlers, found %',n; END IF;
END $check$;
SELECT 'PASS: five protected conflict handlers; no custom serialization retry signal' result;