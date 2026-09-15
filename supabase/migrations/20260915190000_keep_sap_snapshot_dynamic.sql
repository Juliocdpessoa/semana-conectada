-- Mantém a classificação SAP coerente quando o status operacional é alterado
-- depois que a carga detalhada da semana já foi consolidada.
CREATE OR REPLACE FUNCTION public.refresh_sap_snapshot_after_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  confirmation_deadline timestamptz;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status OR NEW.sap_status_snapshot IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT (w.end_date::timestamp + interval '3 days 12 hours') AT TIME ZONE 'America/Sao_Paulo'
  INTO confirmation_deadline
  FROM public.weeks w
  WHERE w.id = NEW.week_id;

  IF NEW.status IN ('NÃO EXECUTADO', 'CANCELADA') THEN
    NEW.sap_status_snapshot := CASE
      WHEN OLD.sap_status_snapshot IN ('Confirmada no SAP', 'Confirmada sem HH', 'Divergência')
        THEN 'Divergência'
      ELSE 'Confirmação não esperada'
    END;
  ELSE
    NEW.sap_status_snapshot := CASE
      WHEN OLD.sap_status_snapshot = 'Divergência' THEN 'Confirmada no SAP'
      WHEN OLD.sap_status_snapshot = 'Confirmação não esperada' THEN
        CASE
          WHEN now() <= confirmation_deadline THEN 'Aguardando confirmação'
          ELSE 'Não confirmada no SAP'
        END
      ELSE OLD.sap_status_snapshot
    END;
  END IF;

  NEW.sap_status_snapshot_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS activities_refresh_sap_snapshot_on_status ON public.activities;
CREATE TRIGGER activities_refresh_sap_snapshot_on_status
BEFORE UPDATE OF status ON public.activities
FOR EACH ROW
EXECUTE FUNCTION public.refresh_sap_snapshot_after_status_change();
