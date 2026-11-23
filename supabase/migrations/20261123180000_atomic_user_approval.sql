-- One fixed, caller-authenticated transaction; no service-role write proxy.
CREATE OR REPLACE FUNCTION public.set_nexo_user_approval(
 p_target_user_id uuid,p_approval_status text,p_roles text[] DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor uuid:=auth.uid();a public.profiles%ROWTYPE;t public.profiles%ROWTYPE;global_admin boolean;
BEGIN
 IF actor IS NULL OR NOT coalesce(public.password_access_allowed(),false) THEN
  RAISE EXCEPTION 'Não foi possível validar o acesso.' USING ERRCODE='PT403';
 END IF;
 IF p_target_user_id IS NULL OR p_approval_status IS NULL OR p_approval_status NOT IN ('approved','blocked','pending')
 OR (p_roles IS NOT NULL AND (coalesce(array_ndims(p_roles),0)<>1 OR cardinality(p_roles) NOT BETWEEN 1 AND 8
  OR EXISTS(SELECT 1 FROM unnest(p_roles) r WHERE r IS NULL OR r NOT IN ('admin','manager','planning','leader','measurement_control','logistics','operation','viewer')))) THEN
  RAISE EXCEPTION 'Aprovação ou perfis inválidos.' USING ERRCODE='PT400';
 END IF;
 -- Lock actor and target in stable order; serialize approval changes, fail
 -- promptly on contention rather than leaving HTTP work pending indefinitely.
 PERFORM set_config('lock_timeout','2s',true);
 PERFORM 1 FROM public.profiles WHERE id IN(actor,p_target_user_id) ORDER BY id FOR UPDATE;
 SELECT * INTO a FROM public.profiles WHERE id=actor;
 SELECT * INTO t FROM public.profiles WHERE id=p_target_user_id;
 IF a.id IS NULL OR a.approval_status<>'approved' OR t.id IS NULL THEN
  RAISE EXCEPTION 'Usuário ou administrador não encontrado.' USING ERRCODE='PT403';
 END IF;
 global_admin:=coalesce(public.is_global_admin(actor),false);
 IF NOT global_admin AND NOT (
  EXISTS(SELECT 1 FROM public.worksite_memberships WHERE user_id=actor AND worksite_id=a.worksite_id AND is_worksite_admin)
  AND EXISTS(SELECT 1 FROM public.worksite_memberships WHERE user_id=p_target_user_id AND worksite_id=a.worksite_id)
 ) THEN RAISE EXCEPTION 'Você só pode aprovar usuários da sua obra.' USING ERRCODE='PT403'; END IF;
 IF NOT global_admin AND 'admin'=ANY(p_roles) THEN
  RAISE EXCEPTION 'Somente o administrador geral pode conceder o perfil administrador.' USING ERRCODE='PT403';
 END IF;
 IF p_approval_status='approved' AND p_roles IS NULL AND NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p_target_user_id) THEN
  RAISE EXCEPTION 'Selecione e salve pelo menos um perfil antes de aprovar o usuário.' USING ERRCODE='PT400';
 END IF;
 UPDATE public.profiles SET approval_status=p_approval_status::public.approval_status,
  approved_by=CASE WHEN p_approval_status='approved' THEN actor END,
  approved_at=CASE WHEN p_approval_status='approved' THEN now() END WHERE id=p_target_user_id;
 IF p_roles IS NOT NULL THEN
  DELETE FROM public.user_roles WHERE user_id=p_target_user_id;
  -- atomic-role-insert: test failure here must roll back both earlier writes.
  INSERT INTO public.user_roles(user_id,role) SELECT p_target_user_id,r::public.app_role FROM (SELECT DISTINCT unnest(p_roles) r) roles;
 END IF;
 RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.set_nexo_user_approval(uuid,text,text[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_nexo_user_approval(uuid,text,text[]) TO authenticated;
NOTIFY pgrst,'reload schema';
