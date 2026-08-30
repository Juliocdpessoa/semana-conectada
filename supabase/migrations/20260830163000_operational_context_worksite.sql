-- Até o administrador geral opera em uma obra por vez.
-- O acesso administrativo global continua disponível por can_admin_worksite.
CREATE OR REPLACE FUNCTION public.can_access_worksite(_user_id uuid, _worksite_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_approved(_user_id)
    AND public.current_worksite_id(_user_id) = _worksite_id
$$;

GRANT EXECUTE ON FUNCTION public.can_access_worksite(uuid,uuid) TO authenticated;
