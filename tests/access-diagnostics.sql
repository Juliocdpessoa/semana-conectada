DO $test$
DECLARE code uuid:=gen_random_uuid();client uuid:=gen_random_uuid();n integer;
BEGIN
 IF has_function_privilege('anon','public.record_app_access_diagnostic(uuid,uuid,text,text,text,text,integer,integer,text[],uuid)','EXECUTE')
 OR has_function_privilege('authenticated','public.record_app_access_diagnostic(uuid,uuid,text,text,text,text,integer,integer,text[],uuid)','EXECUTE')
 THEN RAISE EXCEPTION 'Public diagnostic write exposed'; END IF;
 IF NOT public.record_app_access_diagnostic(code,client,'profile','timeout','activities','access-diag-20261119-v1',1,8000,'{}',NULL) THEN RAISE EXCEPTION 'Insert failed'; END IF;
 IF NOT public.record_app_access_diagnostic(code,client,'profile','timeout','activities','access-diag-20261119-v1',1,8000,'{}',NULL) THEN RAISE EXCEPTION 'Dedup failed'; END IF;
 SELECT count(*) INTO n FROM public.app_access_diagnostics WHERE id=code;
 IF n<>1 THEN RAISE EXCEPTION 'Duplicate rows'; END IF;
 IF public.record_app_access_diagnostic(gen_random_uuid(),client,'profile','timeout','activities','access-diag-20261119-v1',1,8000,ARRAY['https://host/?token=SECRET'],NULL) THEN RAISE EXCEPTION 'Unsafe URL accepted'; END IF;
 FOR i IN 1..5 LOOP
 PERFORM public.record_app_access_diagnostic(gen_random_uuid(),client,'profile','timeout','activities','access-diag-20261119-v1',1,8000,'{}',NULL);
 END LOOP;
 IF public.record_app_access_diagnostic(gen_random_uuid(),client,'profile','timeout','activities','access-diag-20261119-v1',1,8000,'{}',NULL) THEN RAISE EXCEPTION 'Client rate limit failed'; END IF;
 PERFORM set_config('request.jwt.claim.sub','d5894652-c7c6-4310-a1ca-1246720af719',true);
END $test$;
SET LOCAL ROLE authenticated;
DO $privacy$ BEGIN
 IF EXISTS(SELECT 1 FROM public.app_access_diagnostics) THEN RAISE EXCEPTION 'Non-admin can read diagnostic data'; END IF;
END $privacy$;
RESET ROLE;
SELECT 'PASS: service-only writes, no unsafe URLs, deduplication, rate limit, non-admin RLS' result;