-- Restaura o papel padrão removido acidentalmente quando o cadastro passou a
-- criar também o vínculo com a obra.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'leader')
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
END;
$$;

-- Corrige somente cadastros sem qualquer papel. Papéis já definidos não são
-- modificados nem recebem Líder adicionalmente.
INSERT INTO public.user_roles (user_id, role)
SELECT p.id, 'leader'::public.app_role
FROM public.profiles p
WHERE NOT EXISTS (
  SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id
)
ON CONFLICT (user_id, role) DO NOTHING;
