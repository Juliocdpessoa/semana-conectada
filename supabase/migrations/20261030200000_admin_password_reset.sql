-- Admin password reset uses the Auth Admin API, never a plaintext password column.
CREATE TABLE IF NOT EXISTS public.password_reset_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
 reset_id uuid NOT NULL, event text NOT NULL CHECK(event IN ('requested','completed')),
 actor_id uuid NOT NULL, actor_name text, happened_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.password_reset_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.password_reset_audit FROM anon, authenticated;
GRANT SELECT ON public.password_reset_audit TO authenticated;
GRANT ALL ON public.password_reset_audit TO service_role;
DROP POLICY IF EXISTS password_reset_audit_admin_read ON public.password_reset_audit;
CREATE POLICY password_reset_audit_admin_read ON public.password_reset_audit FOR SELECT TO authenticated
USING (public.is_global_admin(auth.uid()) OR EXISTS (
 SELECT 1 FROM public.worksite_memberships m WHERE m.user_id=password_reset_audit.user_id
 AND public.can_admin_worksite(auth.uid(),m.worksite_id)));

CREATE OR REPLACE FUNCTION public.password_reset_state() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r jsonb; session_ok boolean; approved boolean; expired boolean;
BEGIN
 IF auth.uid() IS NULL THEN RETURN jsonb_build_object('required',false,'allowed',false,'can_change',false,'expired',false,'reset_id',null); END IF;
 SELECT raw_app_meta_data->'nexo_password_reset' INTO r FROM auth.users WHERE id=auth.uid();
 IF r IS NULL OR r->>'id' IS NULL THEN
  RETURN jsonb_build_object('required',false,'allowed',true,'can_change',false,'expired',false,'reset_id',null);
 END IF;
 SELECT EXISTS(SELECT 1 FROM auth.sessions s WHERE s.user_id=auth.uid()
  AND s.id::text=auth.jwt()->>'session_id' AND s.created_at >= (r->>'requested_at')::timestamptz) INTO session_ok;
 SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND approval_status='approved') INTO approved;
 expired:=coalesce((r->>'expires_at')::timestamptz <= now(),true);
 RETURN jsonb_build_object('required',coalesce((r->>'required')::boolean,false),
  'allowed',session_ok AND NOT coalesce((r->>'required')::boolean,false),
  'can_change',session_ok AND approved AND NOT expired AND coalesce((r->>'required')::boolean,false),
  'expired',expired AND coalesce((r->>'required')::boolean,false),'reset_id',r->>'id');
END $$;
REVOKE ALL ON FUNCTION public.password_reset_state() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.password_reset_state() TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.password_access_allowed() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce((public.password_reset_state()->>'allowed')::boolean,false)
$$;
REVOKE ALL ON FUNCTION public.password_access_allowed() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.password_access_allowed() TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.audit_password_reset_transition() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE old_reset jsonb:=OLD.raw_app_meta_data->'nexo_password_reset';
 new_reset jsonb:=NEW.raw_app_meta_data->'nexo_password_reset';
BEGIN
 IF old_reset IS NOT DISTINCT FROM new_reset THEN RETURN NEW; END IF;
 IF coalesce((old_reset->>'required')::boolean,false) AND NOT coalesce((new_reset->>'required')::boolean,false) THEN
  IF new_reset->>'id' IS DISTINCT FROM old_reset->>'id' OR NEW.encrypted_password IS NOT DISTINCT FROM OLD.encrypted_password THEN
   RAISE EXCEPTION 'Reset alterado ou senha não atualizada. Entre novamente.';
  END IF;
  INSERT INTO public.password_reset_audit(user_id,reset_id,event,actor_id,actor_name)
   VALUES(NEW.id,(new_reset->>'id')::uuid,'completed',NEW.id,null);
 ELSIF coalesce((new_reset->>'required')::boolean,false) AND new_reset->>'id' IS DISTINCT FROM old_reset->>'id' THEN
  INSERT INTO public.password_reset_audit(user_id,reset_id,event,actor_id,actor_name)
   VALUES(NEW.id,(new_reset->>'id')::uuid,'requested',(new_reset->>'requested_by')::uuid,new_reset->>'requested_by_name');
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.audit_password_reset_transition() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS nexo_password_reset_audit ON auth.users;
CREATE TRIGGER nexo_password_reset_audit BEFORE UPDATE OF raw_app_meta_data,encrypted_password ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.audit_password_reset_transition();

-- Restrictive policies complement existing permissions, never grant new access.
-- An init-plan evaluates the gate once per statement, not once per activity row.
DO $$
DECLARE t record;
BEGIN
 FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND rowsecurity LOOP
  EXECUTE format('DROP POLICY IF EXISTS password_change_gate ON public.%I',t.tablename);
  EXECUTE format('CREATE POLICY password_change_gate ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.password_access_allowed())) WITH CHECK ((SELECT public.password_access_allowed()))',t.tablename);
 END LOOP;
END $$;

-- SECURITY DEFINER RPCs also rely on these helpers, so the gate applies there too.
CREATE OR REPLACE FUNCTION public.is_approved(_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.profiles p JOIN auth.users u ON u.id=p.id
  WHERE p.id=_user_id AND p.approval_status='approved'
  AND NOT coalesce((u.raw_app_meta_data->'nexo_password_reset'->>'required')::boolean,false))
 AND (_user_id IS DISTINCT FROM auth.uid() OR public.password_access_allowed())
$$;
CREATE OR REPLACE FUNCTION public.is_global_admin(_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT public.is_approved(_user_id) AND EXISTS(
 SELECT 1 FROM public.profiles WHERE id=_user_id AND lower(email)='julio.pessoa@normatel.com.br')
$$;

CREATE INDEX IF NOT EXISTS password_reset_audit_user_time ON public.password_reset_audit(user_id,happened_at DESC);
CREATE OR REPLACE VIEW public.password_reset_latest WITH (security_invoker=true) AS
 SELECT DISTINCT ON (user_id) user_id,event,happened_at,actor_name
 FROM public.password_reset_audit ORDER BY user_id,happened_at DESC,id DESC;
REVOKE ALL ON public.password_reset_latest FROM anon;
GRANT SELECT ON public.password_reset_latest TO authenticated,service_role;
