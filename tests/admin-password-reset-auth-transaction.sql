-- Regression: Auth Admin API uses two UPDATE statements in one transaction.
BEGIN;
DO $test$
DECLARE u uuid:=gen_random_uuid(); rid uuid:=gen_random_uuid(); r jsonb; failure boolean:=false; n int;
BEGIN
 INSERT INTO auth.users(id,email,encrypted_password,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
 VALUES(u,'reset-fix-fixture@example.invalid','fixture-original',jsonb_build_object('full_name','Reset fixture','worksite_id','52504243-0000-4000-8000-000000000001'),'{}',now(),now());
 r:=jsonb_build_object('id',rid,'required',true,'requested_at',now(),'expires_at',now()+interval '1 day','requested_by',u);
 UPDATE auth.users SET encrypted_password='fixture-temporary',raw_app_meta_data=jsonb_build_object('nexo_password_reset',r) WHERE id=u;
 BEGIN
 UPDATE auth.users SET raw_app_meta_data=jsonb_build_object('nexo_password_reset',r||'{"required":false}'::jsonb) WHERE id=u;
 EXCEPTION WHEN raise_exception THEN failure:=true;
 END;
 IF NOT failure THEN RAISE EXCEPTION 'Requirement removed without a password change'; END IF;
 -- Exact split UPDATE sequence used by Auth Admin API.
 UPDATE auth.users SET encrypted_password='fixture-personal' WHERE id=u;
 failure:=false;
 BEGIN
 UPDATE auth.users SET raw_app_meta_data=jsonb_build_object('nexo_password_reset',r||jsonb_build_object('id',gen_random_uuid(),'required',false)) WHERE id=u;
 EXCEPTION WHEN raise_exception THEN failure:=true;
 END;
 IF NOT failure THEN RAISE EXCEPTION 'Stale reset id accepted'; END IF;
 UPDATE auth.users SET raw_app_meta_data=jsonb_build_object('nexo_password_reset',r||'{"required":false}'::jsonb) WHERE id=u;
 IF EXISTS(SELECT 1 FROM auth.users WHERE id=u AND (raw_app_meta_data->'nexo_password_reset'->>'required')::boolean) THEN RAISE EXCEPTION 'Split completion failed'; END IF;
 SELECT count(*) INTO n FROM public.password_reset_audit WHERE user_id=u AND event='completed';
 IF n<>1 THEN RAISE EXCEPTION 'Incorrect completion audit count'; END IF;
 IF EXISTS(SELECT 1 FROM public.password_reset_write_proofs WHERE user_id=u) THEN RAISE EXCEPTION 'Proof not consumed'; END IF;
 -- Proofs from another transaction must not allow clearing the flag.
 r:=r||jsonb_build_object('id',gen_random_uuid());
 UPDATE auth.users SET encrypted_password='fixture-temporary-2',raw_app_meta_data=jsonb_build_object('nexo_password_reset',r) WHERE id=u;
 INSERT INTO public.password_reset_write_proofs VALUES(u,(r->>'id')::uuid,txid_current()-1);
 failure:=false;
 BEGIN
 UPDATE auth.users SET raw_app_meta_data=jsonb_build_object('nexo_password_reset',r||'{"required":false}'::jsonb) WHERE id=u;
 EXCEPTION WHEN raise_exception THEN failure:=true;
 END;
 IF NOT failure THEN RAISE EXCEPTION 'Proof from another transaction accepted'; END IF;
END $test$;
SELECT 'passed: split Auth updates, no-password bypass denied, stale reset denied, stale transaction denied, audit exactly once' AS result;

ROLLBACK;
