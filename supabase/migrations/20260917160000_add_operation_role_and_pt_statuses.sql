-- Perfil Operação: leitura geral das atividades e alteração limitada ao fluxo de PT.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'operation';

CREATE OR REPLACE FUNCTION public.current_role_label(_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_user_id AND role::text='admin') THEN 'admin'
    WHEN EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_user_id AND role::text='manager') THEN 'manager'
    WHEN EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_user_id AND role::text='planning') THEN 'planning'
    WHEN EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_user_id AND role::text='leader') THEN 'leader'
    WHEN EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_user_id AND role::text='operation') THEN 'operation'
    WHEN EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_user_id AND role::text='measurement_control') THEN 'measurement_control'
    WHEN EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_user_id AND role::text='logistics') THEN 'logistics'
    WHEN EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_user_id AND role::text='viewer') THEN 'viewer'
    ELSE NULL
  END
$$;

-- Consulta e Operação podem ler atividades da obra ativa, mas semanas em
-- preparação continuam exclusivas do Planejamento/Administrador.
DROP POLICY IF EXISTS "activities read operation and viewer" ON public.activities;
CREATE POLICY "activities read operation and viewer"
ON public.activities FOR SELECT TO authenticated
USING (
  public.can_access_worksite(auth.uid(), worksite_id)
  AND EXISTS (
    SELECT 1 FROM public.weeks w
    WHERE w.id = activities.week_id
      AND w.worksite_id = activities.worksite_id
      AND w.lifecycle_status <> 'preparation'
  )
  AND EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role::text IN ('operation', 'viewer')
  )
);

-- Defesa no banco: impede que Consulta atualize por chamada direta e limita
-- Operação aos dois status autorizados, mesmo fora da interface.
CREATE OR REPLACE FUNCTION public.enforce_activity_update_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_full_access boolean;
  v_operation boolean;
BEGIN
  -- Atualizações internas/service role não possuem auth.uid().
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;

  SELECT
    bool_or(role::text IN ('admin', 'manager', 'planning', 'leader')),
    bool_or(role::text = 'operation')
  INTO v_full_access, v_operation
  FROM public.user_roles
  WHERE user_id = auth.uid();

  IF coalesce(v_full_access, false) THEN RETURN NEW; END IF;

  IF coalesce(v_operation, false) THEN
    IF NEW.status NOT IN ('PT EM ASSINATURA', 'PT PRÉ-EMITIDA')
      OR NEW.justification IS DISTINCT FROM OLD.justification
      OR NEW.observation IS DISTINCT FROM OLD.observation
    THEN
      RAISE EXCEPTION 'O perfil Operação pode alterar somente os status de pré-emissão e envio para assinatura.';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'O perfil Consulta possui acesso somente para visualização.';
END;
$$;

DROP TRIGGER IF EXISTS aa_enforce_activity_update_role ON public.activities;
CREATE TRIGGER aa_enforce_activity_update_role
BEFORE UPDATE ON public.activities
FOR EACH ROW EXECUTE FUNCTION public.enforce_activity_update_role();
