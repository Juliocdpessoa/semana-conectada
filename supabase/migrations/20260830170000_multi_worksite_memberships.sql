-- Acesso de um usuário a uma ou mais obras. profiles.worksite_id permanece como
-- o contexto operacional ativo, nunca como autorização por si só.
CREATE TABLE IF NOT EXISTS public.worksite_memberships (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  worksite_id uuid NOT NULL REFERENCES public.worksites(id) ON DELETE CASCADE,
  is_worksite_admin boolean NOT NULL DEFAULT false,
  granted_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, worksite_id)
);

CREATE INDEX IF NOT EXISTS worksite_memberships_worksite_idx
  ON public.worksite_memberships(worksite_id, user_id);

-- Mantém os acessos atuais e reconhece os administradores já existentes como
-- administradores locais da obra atual. Julio continua administrador geral.
INSERT INTO public.worksite_memberships (user_id, worksite_id, is_worksite_admin)
SELECT p.id, p.worksite_id,
  EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id AND ur.role::text = 'admin')
FROM public.profiles p
WHERE p.worksite_id IS NOT NULL
ON CONFLICT (user_id, worksite_id) DO UPDATE
SET is_worksite_admin = EXCLUDED.is_worksite_admin;

ALTER TABLE public.worksite_memberships ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.worksite_memberships TO authenticated;
GRANT ALL ON public.worksite_memberships TO service_role;

CREATE OR REPLACE FUNCTION public.has_worksite_membership(_user_id uuid, _worksite_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_approved(_user_id) AND EXISTS (
    SELECT 1 FROM public.worksite_memberships m
    WHERE m.user_id = _user_id AND m.worksite_id = _worksite_id
  )
$$;

CREATE OR REPLACE FUNCTION public.can_access_worksite(_user_id uuid, _worksite_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_approved(_user_id)
    AND public.current_worksite_id(_user_id) = _worksite_id
    AND (public.is_global_admin(_user_id) OR public.has_worksite_membership(_user_id, _worksite_id))
$$;

CREATE OR REPLACE FUNCTION public.can_admin_worksite(_user_id uuid, _worksite_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_approved(_user_id) AND (
    public.is_global_admin(_user_id)
    OR EXISTS (
      SELECT 1 FROM public.worksite_memberships m
      WHERE m.user_id = _user_id
        AND m.worksite_id = _worksite_id
        AND m.is_worksite_admin = true
    )
  )
$$;

GRANT EXECUTE ON FUNCTION public.has_worksite_membership(uuid,uuid) TO authenticated;

DROP POLICY IF EXISTS "memberships visible to owner or administrator" ON public.worksite_memberships;
CREATE POLICY "memberships visible to owner or administrator"
ON public.worksite_memberships FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR public.is_global_admin(auth.uid())
  OR public.can_admin_worksite(auth.uid(), worksite_id)
);

-- No cadastro, o vínculo inicial é criado automaticamente e fica sujeito à
-- aprovação normal do perfil.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  requested_worksite uuid;
BEGIN
  BEGIN
    requested_worksite := nullif(NEW.raw_user_meta_data->>'worksite_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    requested_worksite := NULL;
  END;
  IF requested_worksite IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.worksites WHERE id = requested_worksite AND is_active = true
  ) THEN
    requested_worksite := '52504243-0000-4000-8000-000000000001';
  END IF;
  INSERT INTO public.profiles (id, email, full_name, approval_status, worksite_id)
  VALUES (
    NEW.id,
    coalesce(NEW.email, ''),
    coalesce(NEW.raw_user_meta_data->>'full_name', split_part(coalesce(NEW.email, ''), '@', 1)),
    'pending',
    requested_worksite
  );
  INSERT INTO public.worksite_memberships (user_id, worksite_id)
  VALUES (NEW.id, requested_worksite)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

-- Obras: visitantes veem as ativas para cadastro; autenticados veem apenas as
-- atribuídas, salvo o administrador geral.
DROP POLICY IF EXISTS "active worksites are visible for registration" ON public.worksites;
DROP POLICY IF EXISTS "active worksites for signup" ON public.worksites;
DROP POLICY IF EXISTS "assigned worksites for authenticated users" ON public.worksites;
CREATE POLICY "active worksites for signup" ON public.worksites FOR SELECT TO anon
USING (is_active = true);
CREATE POLICY "assigned worksites for authenticated users" ON public.worksites FOR SELECT TO authenticated
USING (
  public.is_global_admin(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.worksite_memberships m
    WHERE m.user_id = auth.uid() AND m.worksite_id = worksites.id
  )
);

-- Perfis da obra ativa ficam visíveis ao administrador local mesmo quando o
-- usuário possui outra obra como contexto ativo.
DROP POLICY IF EXISTS "profiles select within worksite" ON public.profiles;
DROP POLICY IF EXISTS "profiles update within worksite" ON public.profiles;
CREATE POLICY "profiles select within worksite" ON public.profiles FOR SELECT TO authenticated
USING (
  id = auth.uid()
  OR public.is_global_admin(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.worksite_memberships target_membership
    WHERE target_membership.user_id = profiles.id
      AND public.can_admin_worksite(auth.uid(), target_membership.worksite_id)
  )
);
CREATE POLICY "profiles update within worksite" ON public.profiles FOR UPDATE TO authenticated
USING (
  public.is_global_admin(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.worksite_memberships target_membership
    WHERE target_membership.user_id = profiles.id
      AND public.can_admin_worksite(auth.uid(), target_membership.worksite_id)
  )
)
WITH CHECK (true);

