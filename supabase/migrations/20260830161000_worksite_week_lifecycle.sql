-- O ciclo semanal deve ser independente em cada obra.
DROP INDEX IF EXISTS public.weeks_only_one_preparation;
CREATE UNIQUE INDEX IF NOT EXISTS weeks_only_one_preparation_per_worksite
  ON public.weeks (worksite_id)
  WHERE lifecycle_status = 'preparation';

CREATE UNIQUE INDEX IF NOT EXISTS weeks_only_one_operational_per_worksite
  ON public.weeks (worksite_id)
  WHERE lifecycle_status = 'operational';

CREATE OR REPLACE FUNCTION public.activate_operational_week(p_week_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  target_worksite_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(), 'planning') OR public.has_role(auth.uid(), 'admin')
  ) THEN
    RAISE EXCEPTION 'Somente Planejamento ou Administrador pode ativar uma semana.';
  END IF;

  SELECT worksite_id INTO target_worksite_id
  FROM public.weeks
  WHERE id = p_week_id;

  IF target_worksite_id IS NULL THEN
    RAISE EXCEPTION 'Semana não encontrada.';
  END IF;

  IF NOT public.can_access_worksite(auth.uid(), target_worksite_id) THEN
    RAISE EXCEPTION 'A semana pertence a outra obra.';
  END IF;

  UPDATE public.weeks
  SET is_active = false,
      lifecycle_status = 'closed',
      closed_at = now()
  WHERE worksite_id = target_worksite_id
    AND is_active = true
    AND id <> p_week_id;

  UPDATE public.weeks
  SET is_active = true,
      lifecycle_status = 'operational',
      activated_by = auth.uid(),
      activated_at = now(),
      closed_at = NULL
  WHERE id = p_week_id
    AND worksite_id = target_worksite_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.activate_operational_week(uuid) TO authenticated;
