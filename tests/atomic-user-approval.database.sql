-- Run only inside BEGIN + candidate migration + this script + ROLLBACK.
-- Synthetic accounts/sites are never committed, and no live target is edited.
INSERT INTO public.worksites(id,code,name) VALUES
 ('f1000000-0000-4000-8000-000000000001','AUD_APRV_A','Synthetic approval A'),
 ('f1000000-0000-4000-8000-000000000002','AUD_APRV_B','Synthetic approval B');
INSERT INTO auth.users(id,email,raw_user_meta_data,raw_app_meta_data) VALUES
 ('f2000000-0000-4000-8000-000000000001','approval-actor@example.invalid','{"worksite_id":"f1000000-0000-4000-8000-000000000001"}','{}'),
 ('f2000000-0000-4000-8000-000000000002','approval-target@example.invalid','{"worksite_id":"f1000000-0000-4000-8000-000000000001"}','{}'),
 ('f2000000-0000-4000-8000-000000000003','approval-other@example.invalid','{"worksite_id":"f1000000-0000-4000-8000-000000000002"}','{}'),
 ('f2000000-0000-4000-8000-000000000004','approval-viewer@example.invalid','{"worksite_id":"f1000000-0000-4000-8000-000000000001"}','{}');
UPDATE public.profiles SET approval_status='approved' WHERE id IN('f2000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000004');
UPDATE public.worksite_memberships SET is_worksite_admin=true WHERE user_id='f2000000-0000-4000-8000-000000000001';
SELECT set_config('request.jwt.claims','{"sub":"f2000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $test$
DECLARE target uuid:='f2000000-0000-4000-8000-000000000002';definition text;before_profile jsonb;before_roles jsonb;
BEGIN
 IF has_function_privilege('anon','public.set_nexo_user_approval(uuid,text,text[])','EXECUTE')
 OR NOT has_function_privilege('authenticated','public.set_nexo_user_approval(uuid,text,text[])','EXECUTE') THEN RAISE EXCEPTION 'Bad execute ACL'; END IF;
 PERFORM public.set_nexo_user_approval(target,'approved',ARRAY['planning','operation','planning']);
 IF (SELECT approval_status FROM public.profiles WHERE id=target)<>'approved'
 OR (SELECT count(*) FROM public.user_roles WHERE user_id=target)<>2 THEN RAISE EXCEPTION 'Atomic success/dedup failed'; END IF;
 PERFORM public.set_nexo_user_approval(target,'blocked',NULL);
 IF (SELECT count(*) FROM public.user_roles WHERE user_id=target)<>2 THEN RAISE EXCEPTION 'Status-only altered roles'; END IF;
 BEGIN PERFORM public.set_nexo_user_approval(target,'approved',ARRAY['admin']);RAISE EXCEPTION 'Local admin escalation';
 EXCEPTION WHEN SQLSTATE 'PT403' THEN NULL;END;
 BEGIN PERFORM public.set_nexo_user_approval('f2000000-0000-4000-8000-000000000003','approved',ARRAY['viewer']);RAISE EXCEPTION 'Cross-site bypass';
 EXCEPTION WHEN SQLSTATE 'PT403' THEN NULL;END;
 BEGIN PERFORM public.set_nexo_user_approval(target,'approved',ARRAY[]::text[]);RAISE EXCEPTION 'Empty roles accepted';
 EXCEPTION WHEN SQLSTATE 'PT400' THEN NULL;END;
 BEGIN PERFORM public.set_nexo_user_approval(target,'approved',ARRAY['invalid']);RAISE EXCEPTION 'Unknown role accepted';
 EXCEPTION WHEN SQLSTATE 'PT400' THEN NULL;END;
 BEGIN PERFORM public.set_nexo_user_approval(target,'approved',ARRAY[NULL]::text[]);RAISE EXCEPTION 'Null role accepted';
 EXCEPTION WHEN SQLSTATE 'PT400' THEN NULL;END;
 -- Force failure exactly between DELETE and INSERT on this uncommitted candidate.
 SELECT pg_get_functiondef('public.set_nexo_user_approval(uuid,text,text[])'::regprocedure) INTO definition;
 IF position('-- atomic-role-insert' IN definition)=0 THEN RAISE EXCEPTION 'Injection marker missing'; END IF;
 SELECT to_jsonb(p) INTO before_profile FROM public.profiles p WHERE id=target;
 SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) INTO before_roles FROM public.user_roles r WHERE user_id=target;
 EXECUTE replace(definition,'-- atomic-role-insert',E'RAISE EXCEPTION ''synthetic role-insert failure'';\n -- atomic-role-insert');
 BEGIN
  PERFORM public.set_nexo_user_approval(target,'approved',ARRAY['leader']);RAISE EXCEPTION 'Failure was not injected';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'synthetic role-insert failure' THEN RAISE;END IF;END;
 IF before_profile IS DISTINCT FROM (SELECT to_jsonb(p) FROM public.profiles p WHERE id=target)
 OR before_roles IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.user_roles r WHERE user_id=target)
 THEN RAISE EXCEPTION 'Partial mutation survived';END IF;
 EXECUTE definition;
 DELETE FROM public.user_roles WHERE user_id=target;
 BEGIN PERFORM public.set_nexo_user_approval(target,'approved',NULL);RAISE EXCEPTION 'Approved empty account';
 EXCEPTION WHEN SQLSTATE 'PT400' THEN NULL;END;
END $test$;
SELECT set_config('request.jwt.claims','{"sub":"f2000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
DO $test$ BEGIN
 BEGIN PERFORM public.set_nexo_user_approval('f2000000-0000-4000-8000-000000000002','approved',ARRAY['leader']);RAISE EXCEPTION 'Ordinary user bypass';
 EXCEPTION WHEN SQLSTATE 'PT403' THEN NULL;END;
END $test$;
SELECT set_config('request.jwt.claims','{}',true);
DO $test$ BEGIN
 BEGIN PERFORM public.set_nexo_user_approval('f2000000-0000-4000-8000-000000000002','approved',ARRAY['leader']);RAISE EXCEPTION 'Anonymous bypass';
 EXCEPTION WHEN SQLSTATE 'PT403' THEN NULL;END;
END $test$;
-- Global caller uses its unchanged authority, but edits only the synthetic target.
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',(SELECT id FROM public.profiles WHERE public.is_global_admin(id) LIMIT 1),'role','authenticated')::text,true);
DO $test$ BEGIN
 PERFORM public.set_nexo_user_approval('f2000000-0000-4000-8000-000000000003','approved',ARRAY['admin']);
 IF NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id='f2000000-0000-4000-8000-000000000003' AND role='admin') THEN RAISE EXCEPTION 'Global scope lost';END IF;
END $test$;
SELECT set_config('request.jwt.claims','{"sub":"f2000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
UPDATE public.profiles SET approval_status='blocked' WHERE id='f2000000-0000-4000-8000-000000000001';
DO $test$ BEGIN
 BEGIN PERFORM public.set_nexo_user_approval('f2000000-0000-4000-8000-000000000002','approved',ARRAY['leader']);RAISE EXCEPTION 'Blocked actor bypass';
 EXCEPTION WHEN SQLSTATE 'PT403' THEN NULL;END;
END $test$;
UPDATE public.profiles SET approval_status='approved' WHERE id='f2000000-0000-4000-8000-000000000001';
UPDATE auth.users SET raw_app_meta_data='{"nexo_password_reset":{"required":true,"id":"f3000000-0000-4000-8000-000000000001","requested_by":"f2000000-0000-4000-8000-000000000001","requested_by_name":"Synthetic test"}}' WHERE id='f2000000-0000-4000-8000-000000000001';
DO $test$ BEGIN
 BEGIN PERFORM public.set_nexo_user_approval('f2000000-0000-4000-8000-000000000002','approved',ARRAY['leader']);RAISE EXCEPTION 'Password gate bypass';
 EXCEPTION WHEN SQLSTATE 'PT403' THEN NULL;END;
END $test$;
SELECT 'atomic success, role preservation, injected rollback, local scope, escalation denial, malformed roles and anonymous denial passed' result;
