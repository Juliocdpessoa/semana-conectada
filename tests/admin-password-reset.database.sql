-- Run only inside an explicit transaction with ROLLBACK, after applying the migration.
DO $test$
DECLARE uid uuid:=gen_random_uuid(); sid uuid:=gen_random_uuid(); old_sid uuid:=gen_random_uuid();
 rid uuid:=gen_random_uuid(); r jsonb; s jsonb; seen int; rejected boolean:=false;
BEGIN
 INSERT INTO auth.users(id,email,encrypted_password,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
 VALUES(uid,'nexo-password-fixture@example.invalid','fixture-old',
 jsonb_build_object('full_name','Temporary password fixture','worksite_id','52504243-0000-4000-8000-000000000001'),'{}',now(),now());
 UPDATE public.profiles SET approval_status='approved' WHERE id=uid;
 INSERT INTO auth.sessions(id,user_id,created_at) VALUES(sid,uid,now()),(old_sid,uid,now()-interval '1 day');
 PERFORM set_config('request.jwt.claim.sub',uid::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',uid,'session_id',sid,'role','authenticated')::text,true);
 IF NOT public.password_access_allowed() THEN RAISE EXCEPTION 'Existing account unexpectedly blocked'; END IF;
 r:=jsonb_build_object('id',rid,'required',true,'requested_at',now()-interval '1 minute',
 'expires_at',now()+interval '1 day','requested_by',uid,'requested_by_name','Fixture admin');
 UPDATE auth.users SET encrypted_password='fixture-temporary',raw_app_meta_data=jsonb_build_object('nexo_password_reset',r) WHERE id=uid;
 s:=public.password_reset_state();
 IF NOT (s->>'required')::boolean OR (s->>'allowed')::boolean OR NOT (s->>'can_change')::boolean THEN RAISE EXCEPTION 'Pending gate failed: %',s; END IF;
 EXECUTE 'SET LOCAL ROLE authenticated';
 SELECT count(*) INTO seen FROM public.profiles WHERE id=uid;
 IF seen<>0 THEN RAISE EXCEPTION 'RLS exposed profile while reset pending'; END IF;
 EXECUTE 'RESET ROLE';
 IF public.is_approved(uid) THEN RAISE EXCEPTION 'Security definer helpers allow pending account'; END IF;
 SELECT count(*) INTO seen FROM public.password_reset_audit WHERE user_id=uid AND event='requested';
 IF seen<>1 THEN RAISE EXCEPTION 'Reset audit missing'; END IF;
 -- A stale completion cannot overwrite a more recent administrator reset.
 rejected:=false;
 BEGIN
 UPDATE auth.users SET encrypted_password='fixture-stale-change',
 raw_app_meta_data=jsonb_build_object('nexo_password_reset',r||jsonb_build_object('id',gen_random_uuid(),'required',false)) WHERE id=uid;
 EXCEPTION WHEN raise_exception THEN rejected:=true;
 END;
 IF NOT rejected THEN RAISE EXCEPTION 'Stale completion was accepted'; END IF;
 rejected:=false;
 -- A client cannot clear the requirement without changing its password.
 BEGIN
 UPDATE auth.users SET raw_app_meta_data=jsonb_build_object('nexo_password_reset',r||'{"required":false}'::jsonb) WHERE id=uid;
 EXCEPTION WHEN raise_exception THEN rejected:=true;
 END;
 IF NOT rejected THEN RAISE EXCEPTION 'Cleared requirement without changing password'; END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',uid,'session_id',old_sid,'role','authenticated')::text,true);
 IF (public.password_reset_state()->>'can_change')::boolean THEN RAISE EXCEPTION 'Old session can complete reset'; END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',uid,'session_id',sid,'role','authenticated')::text,true);
 UPDATE auth.users SET encrypted_password='fixture-personal',raw_app_meta_data=jsonb_build_object('nexo_password_reset',r||jsonb_build_object('required',false,'completed_at',now())) WHERE id=uid;
 IF NOT public.password_access_allowed() OR NOT public.is_approved(uid) THEN RAISE EXCEPTION 'Completed account blocked'; END IF;
 EXECUTE 'SET LOCAL ROLE authenticated';
 SELECT count(*) INTO seen FROM public.profiles WHERE id=uid;
 IF seen<>1 THEN RAISE EXCEPTION 'RLS did not restore existing owner permission'; END IF;
 EXECUTE 'RESET ROLE';
 SELECT count(*) INTO seen FROM public.password_reset_audit WHERE user_id=uid AND event='completed';
 IF seen<>1 THEN RAISE EXCEPTION 'Completion audit missing'; END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',uid,'session_id',old_sid,'role','authenticated')::text,true);
 IF public.password_access_allowed() THEN RAISE EXCEPTION 'Old session regained access'; END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',uid,'session_id',sid,'role','authenticated')::text,true);
 r:=jsonb_build_object('id',gen_random_uuid(),'required',true,'requested_at',now()-interval '2 day',
 'expires_at',now()-interval '1 day','requested_by',uid);
 UPDATE auth.users SET encrypted_password='fixture-expired',raw_app_meta_data=jsonb_build_object('nexo_password_reset',r) WHERE id=uid;
 s:=public.password_reset_state();
 IF (s->>'can_change')::boolean OR NOT (s->>'expired')::boolean THEN RAISE EXCEPTION 'Expired reset allowed'; END IF;
 -- Even permissive owner policies must not reveal operational rows.
END $test$;
SELECT 'passed: pending gate, new-session change, old-session denial, immutable requirement, expiry, requested/completed audit, RPC permission helpers' AS result;
