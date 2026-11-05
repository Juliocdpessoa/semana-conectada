-- Fixture-only regression tests. No real approvals. Run after migration.
BEGIN;
DO $test$
DECLARE u uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); d uuid:=gen_random_uuid(); e uuid:=gen_random_uuid();
 batch uuid:=gen_random_uuid(); snap jsonb; outcome jsonb; preserved text;
BEGIN
 INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
 VALUES(u,'overtime-fixture@example.invalid',jsonb_build_object('full_name','Overtime manager fixture','worksite_id','52504243-0000-4000-8000-000000000001'),'{}',now(),now());
 UPDATE public.profiles SET approval_status='approved' WHERE id=u;
 INSERT INTO public.user_roles(user_id,role) VALUES(u,'manager');
 PERFORM set_config('request.jwt.claim.sub',u::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 INSERT INTO public.overtime_requests(id,request_number,requester_user_id,employee_name,employee_registration,employee_role,service_description,overtime_date,departure_time,justification,status,version,batch_id)
 VALUES(a,-931000000001,u,'Fixture A','fixture-a','fixture','fixture',current_date,'18:30','fixture','pending',2,batch),
 (b,-931000000002,u,'Fixture B','fixture-b','fixture','fixture',current_date,'18:30','fixture','pending',3,batch),
 (c,-931000000003,u,'Fixture C','fixture-c','fixture','fixture',current_date,'18:30','fixture','cancelled',4,batch),
 (d,-931000000004,u,'Fixture D','fixture-d','fixture','fixture',current_date,'18:30','fixture','approved',5,batch),
 (e,-931000000005,u,'Fixture E','fixture-e','fixture','fixture',current_date,'18:30','fixture','rejected',2,batch);
 SELECT md5(string_agg(to_jsonb(r)::text,'' ORDER BY id)) INTO preserved FROM public.overtime_requests r WHERE id IN(c,d,e);
 SELECT jsonb_agg(jsonb_build_object('id',id,'status',status,'version',version)) INTO snap FROM public.overtime_requests WHERE batch_id=batch;
 outcome:=public.decide_overtime_batch(a,1,snap,'approved',null);
 IF NOT coalesce((outcome->>'conflict')::boolean,false) THEN RAISE EXCEPTION 'Stale representative accepted: %',outcome; END IF;
 IF EXISTS(SELECT 1 FROM public.overtime_requests WHERE id IN(a,b) AND status<>'pending') THEN RAISE EXCEPTION 'Stale decision partially saved'; END IF;
 -- Another member changes after the server read the batch snapshot.
 UPDATE public.overtime_requests SET version=4 WHERE id=b;
 outcome:=public.decide_overtime_batch(a,2,snap,'approved',null);
 IF outcome->>'reason'<>'changed' THEN RAISE EXCEPTION 'Stale member accepted: %',outcome; END IF;
 IF EXISTS(SELECT 1 FROM public.overtime_requests WHERE id IN(a,b) AND status<>'pending') THEN RAISE EXCEPTION 'Member conflict partially saved'; END IF;
 SELECT jsonb_agg(jsonb_build_object('id',id,'status',status,'version',version)) INTO snap FROM public.overtime_requests WHERE batch_id=batch;
 EXECUTE 'SET LOCAL ROLE authenticated';
 outcome:=public.decide_overtime_batch(a,2,snap,'approved',null);
 EXECUTE 'RESET ROLE';
 IF NOT coalesce((outcome->>'ok')::boolean,false) OR (outcome->>'count')::int<>2 THEN RAISE EXCEPTION 'Mixed-version batch failed: %',outcome; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.overtime_requests WHERE id=a AND status='approved' AND version=3 AND decided_by_user_id=u)
 OR NOT EXISTS(SELECT 1 FROM public.overtime_requests WHERE id=b AND status='approved' AND version=5 AND decided_by_user_id=u) THEN RAISE EXCEPTION 'Incorrect version or decider'; END IF;
 IF preserved IS DISTINCT FROM (SELECT md5(string_agg(to_jsonb(r)::text,'' ORDER BY id)) FROM public.overtime_requests r WHERE id IN(c,d,e)) THEN RAISE EXCEPTION 'Existing terminal record changed'; END IF;
 outcome:=public.decide_overtime_batch(a,2,snap,'rejected','fixture');
 IF outcome->>'reason'<>'decided' THEN RAISE EXCEPTION 'Duplicate decision accepted'; END IF;
 UPDATE public.overtime_requests SET status='pending',version=6,batch_id=null WHERE id=b;
 snap:=jsonb_build_array(jsonb_build_object('id',b,'status','pending','version',6));
 outcome:=public.decide_overtime_batch(b,6,snap,'rejected',null);
 IF (outcome->>'ok')::boolean THEN RAISE EXCEPTION 'Rejection without comment accepted'; END IF;
 outcome:=public.decide_overtime_batch(b,6,snap,'rejected','Fixture reason');
 IF NOT (outcome->>'ok')::boolean OR (outcome->>'count')::int<>1 THEN RAISE EXCEPTION 'Standalone rejection failed'; END IF;
 DELETE FROM public.user_roles WHERE user_id=u AND role='manager';
 outcome:=public.decide_overtime_batch(a,3,snap,'approved',null);
 IF (outcome->>'ok')::boolean THEN RAISE EXCEPTION 'Non-manager could approve'; END IF;
END $test$;
SELECT 'passed: independent versions, pending-only, terminal records intact, stale target/member rollback, duplicate denied, rejection reason, standalone, actor audit, viewer denied' AS result;

ROLLBACK;
