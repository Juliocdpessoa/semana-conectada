BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
-- Only a synthetic, inactive week/load is touched; everything is rolled back.
DO $test$ DECLARE a uuid;s uuid;w uuid:=gen_random_uuid();req uuid:=gen_random_uuid();r jsonb;r2 jsonb;rows jsonb:='[{"source_row_number":2,"order_number":"9900000001","confirmation":"9999999999","actual_work":1}]';denied boolean:=false; BEGIN
 SELECT id INTO a FROM public.profiles WHERE approval_status='approved' AND public.is_global_admin(id) LIMIT 1;
 SELECT worksite_id INTO s FROM public.sap_confirmation_imports ORDER BY imported_at DESC LIMIT 1;
 IF a IS NULL OR s IS NULL THEN RAISE EXCEPTION 'Missing authorized fixture context'; END IF;
 INSERT INTO public.weeks(id,code,label,start_date,end_date,is_active,worksite_id) VALUES(w,'__nexo_sap_test__'||w::text,'Synthetic transaction-only SAP test','2026-11-23','2026-11-27',false,s);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated','iat',floor(extract(epoch from now())))::text,true);
 r:=public.import_sap_confirmations_once(req,w,'synthetic-transaction-test.xlsx',rows);
 r2:=public.import_sap_confirmations_once(req,w,'synthetic-transaction-test.xlsx',rows);
 IF r->>'importId' IS DISTINCT FROM r2->>'importId' OR r2->>'replayed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Retry was not replayed'; END IF;
 IF (SELECT count(*) FROM public.sap_confirmation_imports WHERE week_id=w)<>1 OR (SELECT count(*) FROM public.sap_confirmation_rows WHERE week_id=w)<>1 THEN RAISE EXCEPTION 'Duplicate rows or loads'; END IF;
 BEGIN PERFORM public.import_sap_confirmations_once(req,w,'different.xlsx',rows); EXCEPTION WHEN SQLSTATE 'PT409' THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Changed payload reused receipt'; END IF;
 PERFORM set_config('request.jwt.claims','{}',true);denied:=false;
 BEGIN PERFORM public.import_sap_confirmations_once(req,w,'synthetic-transaction-test.xlsx',rows); EXCEPTION WHEN SQLSTATE 'PT403' THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Anonymous was allowed'; END IF;
 IF has_table_privilege('authenticated','public.sap_confirmation_import_receipts','SELECT') OR has_table_privilege('authenticated','public.sap_confirmation_import_receipts','INSERT') THEN RAISE EXCEPTION 'Receipt table exposed'; END IF;
END $test$;
ROLLBACK;

