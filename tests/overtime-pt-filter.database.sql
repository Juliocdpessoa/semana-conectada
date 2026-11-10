BEGIN;
DO $test$
DECLARE u uuid:=gen_random_uuid(); filtered jsonb; baseline jsonb; legacy jsonb;
BEGIN
 INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
 VALUES(u,'pt-filter-fixture@example.invalid',jsonb_build_object('full_name','PT filter fixture','worksite_id','52504243-0000-4000-8000-000000000001'),'{}',now(),now());
 INSERT INTO public.overtime_requests(request_number,requester_user_id,employee_name,employee_registration,employee_role,service_description,overtime_date,departure_time,justification,status,pt_number)
 VALUES(-933000000001,u,'PT filter A','ptfilter-a','fixture','fixture','2099-01-01','18:30','fixture','approved','PTFILTER.001'),
 (-933000000002,u,'PT filter B','ptfilter-b','fixture','fixture','2099-01-01','18:30','fixture','pending','PTFILTER.002'),
 (-933000000003,u,'PT filter C','ptfilter-c','fixture','fixture','2099-01-01','18:30','fixture','cancelled','PTFILTER.001');
 filtered:=public.get_overtime_export_metadata_pt('52504243-0000-4000-8000-000000000001','2099-01-01','2099-01-01',NULL,NULL,'all','','ptfilter');
 IF (filtered->'kpis'->>'total')::int<>2 OR (filtered->'kpis'->>'approved')::int<>1 OR (filtered->'kpis'->>'pending')::int<>1 THEN RAISE EXCEPTION 'PT summary mismatch'; END IF;
 filtered:=public.get_overtime_export_metadata_pt('52504243-0000-4000-8000-000000000001','2099-01-01','2099-01-01',NULL,NULL,'all','','PTFILTER.001');
 IF (filtered->'kpis'->>'total')::int<>1 THEN RAISE EXCEPTION 'Exact PT or cancellation mismatch'; END IF;
 baseline:=public.get_overtime_export_metadata_pt('52504243-0000-4000-8000-000000000001','2099-01-01','2099-01-01',NULL,NULL,'all','','');
 legacy:=public.get_overtime_export_metadata('52504243-0000-4000-8000-000000000001','2099-01-01','2099-01-01',NULL,NULL,'all','');
 IF baseline IS DISTINCT FROM legacy THEN RAISE EXCEPTION 'Blank filter changed existing behavior'; END IF;
 IF has_function_privilege('authenticated','public.get_overtime_export_metadata_pt(uuid,date,date,text,text,text,text,text)','EXECUTE') THEN RAISE EXCEPTION 'Cross-worksite metadata RPC exposed'; END IF;
END $test$;
SELECT 'passed: partial and exact PT, case-insensitive match, cancelled excluded, metadata totals, blank-filter compatibility, service-only authorization' AS result;

ROLLBACK;
