-- Read-only regression after migration.
BEGIN;
DO $test$
DECLARE w uuid; all_count int; yes_count int; no_count int; direct_count int; result jsonb;
BEGIN
 PERFORM set_config('request.jwt.claim.sub','b8b97321-11db-430e-b6b5-40b3cb15f307',true);
 SELECT id INTO STRICT w FROM public.weeks WHERE worksite_id='52504243-0000-4000-8000-000000000001' AND is_active;
 EXECUTE 'SET LOCAL ROLE authenticated';
 result:=public.get_activities_page(w,'{}',0,1); all_count:=(result->'kpis'->>'total')::int;
 result:=public.get_activities_page(w,'{"confinedSpace":"yes"}',0,5000);
 yes_count:=(result->'kpis'->>'total')::int;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(result->'rows') r WHERE NOT(coalesce(r->>'pbs','') ~ '(^|[^0-9])16([^0-9]|$)')) THEN RAISE EXCEPTION 'False positive'; END IF;
 IF jsonb_array_length(result->'rows')<>yes_count THEN RAISE EXCEPTION 'Print fetch does not include all filtered rows'; END IF;
 SELECT count(*) INTO direct_count FROM public.activities WHERE week_id=w AND coalesce(pbs,'') ~ '(^|[^0-9])16([^0-9]|$)';
 IF yes_count<>direct_count THEN RAISE EXCEPTION 'Count mismatch'; END IF;
 IF (result->>'totalAll')::int<>all_count THEN RAISE EXCEPTION 'Unfiltered baseline changed'; END IF;
 result:=public.get_activities_page(w,'{"confinedSpace":"no"}',0,1);
 no_count:=(result->'kpis'->>'total')::int;
 IF all_count<>yes_count+no_count THEN RAISE EXCEPTION 'Partition mismatch'; END IF;
 EXECUTE 'RESET ROLE';
 PERFORM set_config('ec.test_counts',jsonb_build_object('total',all_count,'confined',yes_count,'without',no_count)::text,true);
END $test$;
SELECT current_setting('ec.test_counts')::jsonb AS verified_counts;

ROLLBACK;
