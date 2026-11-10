BEGIN;
DO $test$
DECLARE u uuid:=gen_random_uuid(); other_user uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); d uuid:=gen_random_uuid(); batch uuid:=gen_random_uuid(); result jsonb; original jsonb;
BEGIN
 INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at) VALUES
 (u,'pt-owner-fixture@example.invalid',jsonb_build_object('full_name','PT Owner Fixture','worksite_id','52504243-0000-4000-8000-000000000001'),'{}',now(),now()),
 (other_user,'pt-other-fixture@example.invalid',jsonb_build_object('full_name','PT Other Fixture','worksite_id','52504243-0000-4000-8000-000000000001'),'{}',now(),now());
 UPDATE public.profiles SET approval_status='approved' WHERE id IN(u,other_user);
 INSERT INTO public.user_roles(user_id,role) VALUES(u,'leader'),(other_user,'manager') ON CONFLICT DO NOTHING;
 PERFORM set_config('request.jwt.claim.sub',u::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 INSERT INTO public.overtime_requests(id,request_number,requester_user_id,employee_name,employee_registration,employee_role,service_description,overtime_date,departure_time,justification,status,version,batch_id,pt_number,manager_comment,decided_by_user_id,decided_at) VALUES
 (a,-932000000001,u,'Fixture A','pt-a','fixture','fixture',current_date,'18:30','fixture','approved',2,batch,null,'Approved fixture',other_user,now()-interval '1 day'),
 (b,-932000000002,u,'Fixture B','pt-b','fixture','fixture',current_date,'18:30','fixture','pending',3,batch,null,null,null,null),
 (c,-932000000003,u,'Fixture C','pt-c','fixture','fixture',current_date,'18:30','fixture','approved',4,batch,'PT-existing',null,other_user,now()-interval '1 day'),
 (d,-932000000004,u,'Fixture D','pt-d','fixture','fixture',current_date,'18:30','fixture','cancelled',1,batch,null,null,null,null);
 UPDATE public.overtime_requests SET source_type='scale_change' WHERE id IN(a,b,c,d);
 SELECT to_jsonb(r)-ARRAY['pt_number','pt_updated_at','pt_updated_by','pt_updated_by_name','version','updated_at'] INTO original FROM public.overtime_requests r WHERE id=a;
 result:=public.complete_overtime_pt(a,1,'PT-new',true);
 IF NOT coalesce((result->>'conflict')::boolean,false) THEN RAISE EXCEPTION 'Stale version accepted'; END IF;
 PERFORM set_config('request.jwt.claim.sub',other_user::text,true);
 result:=public.complete_overtime_pt(a,2,'PT-wrong',false);
 IF (result->>'ok')::boolean THEN RAISE EXCEPTION 'Another user could fill PT'; END IF;
 PERFORM set_config('request.jwt.claim.sub',u::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 result:=public.complete_overtime_pt(a,2,' na ',true);
 EXECUTE 'RESET ROLE';
 IF NOT (result->>'ok')::boolean OR (result->>'count')::int<>2 THEN RAISE EXCEPTION 'Late completion failed %',result; END IF;
 IF EXISTS(SELECT 1 FROM public.overtime_requests WHERE id IN(a,b) AND pt_number IS DISTINCT FROM 'NA') THEN RAISE EXCEPTION 'NA not normalized'; END IF;
 IF original IS DISTINCT FROM (SELECT to_jsonb(r)-ARRAY['pt_number','pt_updated_at','pt_updated_by','pt_updated_by_name','version','updated_at'] FROM public.overtime_requests r WHERE id=a) THEN RAISE EXCEPTION 'Approval or operational data changed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.overtime_requests WHERE id=a AND version=3 AND pt_updated_by=u) OR NOT EXISTS(SELECT 1 FROM public.overtime_requests WHERE id=b AND version=4) THEN RAISE EXCEPTION 'Version or attribution missing'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.overtime_requests WHERE id=c AND pt_number='PT-existing' AND version=4) OR NOT EXISTS(SELECT 1 FROM public.overtime_requests WHERE id=d AND pt_number IS NULL AND version=1) THEN RAISE EXCEPTION 'Existing PT or cancellation changed'; END IF;
 IF (SELECT count(*) FROM public.overtime_pt_history WHERE request_id IN(a,b) AND changed_by=u AND new_pt='NA')<>2 THEN RAISE EXCEPTION 'Audit missing'; END IF;
 result:=public.complete_overtime_pt(a,3,'PT-overwrite',false);
 IF (result->>'ok')::boolean THEN RAISE EXCEPTION 'Existing PT overwritten'; END IF;
 result:=public.complete_overtime_pt(d,1,'PT-cancelled',false);
 IF (result->>'ok')::boolean THEN RAISE EXCEPTION 'Cancelled record changed'; END IF;
END $test$;
SELECT 'passed: scale-change late approved completion, atomic batch blanks only, status/decision intact, actor/time audit, other-user denied, existing PT protected, cancellation protected, NA normalized, version checked' AS result;

ROLLBACK;
