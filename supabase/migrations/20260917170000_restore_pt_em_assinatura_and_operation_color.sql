-- Mantém a nomenclatura já utilizada pelo NEXO e libera ao perfil Operação
-- somente os dois status definidos e a seleção da cor da PT.
UPDATE public.activities
SET status = 'PT EM ASSINATURA'
WHERE status = 'PT ENVIADA PARA ASSINATURA';

CREATE OR REPLACE FUNCTION public.enforce_activity_update_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_full_access boolean;
  v_operation boolean;
  v_only_color_changed boolean;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;

  SELECT
    bool_or(role::text IN ('admin', 'manager', 'planning', 'leader')),
    bool_or(role::text = 'operation')
  INTO v_full_access, v_operation
  FROM public.user_roles
  WHERE user_id = auth.uid();

  IF coalesce(v_full_access, false) THEN RETURN NEW; END IF;

  IF coalesce(v_operation, false) THEN
    v_only_color_changed :=
      NEW.status IS NOT DISTINCT FROM OLD.status
      AND NEW.justification IS NOT DISTINCT FROM OLD.justification
      AND NEW.observation IS NOT DISTINCT FROM OLD.observation
      AND NEW.pbs IS NOT DISTINCT FROM OLD.pbs
      AND NEW.pt_number IS NOT DISTINCT FROM OLD.pt_number
      AND NEW.release_type IS NOT DISTINCT FROM OLD.release_type
      AND NEW.scheduled_date IS NOT DISTINCT FROM OLD.scheduled_date;

    IF v_only_color_changed THEN RETURN NEW; END IF;

    IF NEW.status IN ('PT EM ASSINATURA', 'PT PRÉ-EMITIDA')
      AND NEW.justification IS NOT DISTINCT FROM OLD.justification
      AND NEW.observation IS NOT DISTINCT FROM OLD.observation
    THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'O perfil Operação pode alterar somente os status PT EM ASSINATURA e PT PRÉ-EMITIDA, além da cor da PT.';
  END IF;

  RAISE EXCEPTION 'O perfil Consulta possui acesso somente para visualização.';
END;
$$;
