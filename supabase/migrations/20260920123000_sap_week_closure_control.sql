-- Separa a semana operacional do período de fechamento da apropriação SAP.
ALTER TABLE public.weeks
  ADD COLUMN IF NOT EXISTS sap_closure_status text NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS sap_closure_deadline timestamptz,
  ADD COLUMN IF NOT EXISTS sap_closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS sap_closed_by uuid REFERENCES auth.users(id);

-- Alguns ambientes antigos ainda não receberam a migração de snapshot do SAP.
-- Mantém esta migração autocontida e segura para reaplicação.
ALTER TABLE public.activities
  ADD COLUMN IF NOT EXISTS sap_status_snapshot text,
  ADD COLUMN IF NOT EXISTS sap_status_snapshot_at timestamptz;

CREATE OR REPLACE FUNCTION public.can_access_sap(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT public.is_approved(_user_id)
    AND (public.has_role(_user_id,'planning') OR public.has_role(_user_id,'admin'));
$$;

ALTER TABLE public.weeks DROP CONSTRAINT IF EXISTS weeks_sap_closure_status_check;
ALTER TABLE public.weeks
  ADD CONSTRAINT weeks_sap_closure_status_check
  CHECK (sap_closure_status IN ('open', 'closed'));

-- O prazo padrão é a primeira segunda-feira após o fim da semana, às 12h.
UPDATE public.weeks
SET sap_closure_deadline = (
  (end_date + ((8 - extract(isodow FROM end_date)::integer) % 7))::date::timestamp
  + interval '12 hours'
) AT TIME ZONE 'America/Sao_Paulo'
WHERE sap_closure_deadline IS NULL;

CREATE TABLE IF NOT EXISTS public.sap_week_closure_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  worksite_id uuid NOT NULL REFERENCES public.worksites(id) ON DELETE CASCADE,
  week_id uuid NOT NULL REFERENCES public.weeks(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('closed', 'extended', 'reopened')),
  previous_deadline timestamptz,
  new_deadline timestamptz,
  reason text NOT NULL,
  changed_by uuid NOT NULL REFERENCES auth.users(id),
  changed_by_name text,
  changed_by_email text,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sap_week_closure_history_week_idx
  ON public.sap_week_closure_history (week_id, changed_at DESC);

ALTER TABLE public.sap_week_closure_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sap closure history select within worksite" ON public.sap_week_closure_history;
CREATE POLICY "sap closure history select within worksite"
ON public.sap_week_closure_history FOR SELECT TO authenticated
USING (public.can_access_worksite(auth.uid(), worksite_id));
GRANT SELECT ON public.sap_week_closure_history TO authenticated;
GRANT ALL ON public.sap_week_closure_history TO service_role;

CREATE OR REPLACE FUNCTION public.assert_sap_closure_admin(p_week_id uuid)
RETURNS public.weeks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_week public.weeks%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_approved(auth.uid())
     OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Somente o administrador da obra pode controlar o fechamento SAP.';
  END IF;
  SELECT * INTO target_week FROM public.weeks WHERE id = p_week_id;
  IF NOT FOUND OR NOT public.can_access_worksite(auth.uid(), target_week.worksite_id) THEN
    RAISE EXCEPTION 'Semana não encontrada ou sem acesso.';
  END IF;
  RETURN target_week;
END;
$$;

CREATE OR REPLACE FUNCTION public.close_sap_week(p_week_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE target_week public.weeks%ROWTYPE; actor public.profiles%ROWTYPE;
BEGIN
  SELECT * INTO target_week FROM public.assert_sap_closure_admin(p_week_id);
  IF nullif(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Informe o motivo.'; END IF;
  SELECT * INTO actor FROM public.profiles WHERE id = auth.uid();
  UPDATE public.weeks SET sap_closure_status='closed', sap_closed_at=now(), sap_closed_by=auth.uid()
  WHERE id=p_week_id;
  INSERT INTO public.sap_week_closure_history
    (worksite_id,week_id,action,previous_deadline,new_deadline,reason,changed_by,changed_by_name,changed_by_email)
  VALUES (target_week.worksite_id,p_week_id,'closed',target_week.sap_closure_deadline,target_week.sap_closure_deadline,
    left(btrim(p_reason),500),auth.uid(),actor.full_name,actor.email);
END; $$;

CREATE OR REPLACE FUNCTION public.extend_sap_week_deadline(p_week_id uuid, p_deadline timestamptz, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE target_week public.weeks%ROWTYPE; actor public.profiles%ROWTYPE;
BEGIN
  SELECT * INTO target_week FROM public.assert_sap_closure_admin(p_week_id);
  IF p_deadline <= now() THEN RAISE EXCEPTION 'O novo prazo deve estar no futuro.'; END IF;
  IF nullif(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Informe o motivo.'; END IF;
  SELECT * INTO actor FROM public.profiles WHERE id = auth.uid();
  UPDATE public.weeks SET sap_closure_status='open', sap_closure_deadline=p_deadline,
    sap_closed_at=NULL, sap_closed_by=NULL WHERE id=p_week_id;
  INSERT INTO public.sap_week_closure_history
    (worksite_id,week_id,action,previous_deadline,new_deadline,reason,changed_by,changed_by_name,changed_by_email)
  VALUES (target_week.worksite_id,p_week_id,'extended',target_week.sap_closure_deadline,p_deadline,
    left(btrim(p_reason),500),auth.uid(),actor.full_name,actor.email);
END; $$;

CREATE OR REPLACE FUNCTION public.reopen_sap_week(p_week_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE target_week public.weeks%ROWTYPE; actor public.profiles%ROWTYPE; new_deadline timestamptz;
BEGIN
  SELECT * INTO target_week FROM public.assert_sap_closure_admin(p_week_id);
  IF nullif(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Informe o motivo.'; END IF;
  new_deadline := greatest(coalesce(target_week.sap_closure_deadline, now()), now() + interval '2 hours');
  SELECT * INTO actor FROM public.profiles WHERE id = auth.uid();
  UPDATE public.weeks SET sap_closure_status='open', sap_closure_deadline=new_deadline,
    sap_closed_at=NULL, sap_closed_by=NULL WHERE id=p_week_id;
  INSERT INTO public.sap_week_closure_history
    (worksite_id,week_id,action,previous_deadline,new_deadline,reason,changed_by,changed_by_name,changed_by_email)
  VALUES (target_week.worksite_id,p_week_id,'reopened',target_week.sap_closure_deadline,new_deadline,
    left(btrim(p_reason),500),auth.uid(),actor.full_name,actor.email);
END; $$;

REVOKE ALL ON FUNCTION public.assert_sap_closure_admin(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assert_sap_closure_admin(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.close_sap_week(uuid,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.extend_sap_week_deadline(uuid,timestamptz,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reopen_sap_week(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_sap_week(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.extend_sap_week_deadline(uuid,timestamptz,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reopen_sap_week(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.activate_operational_week(p_week_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE target_worksite_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.has_role(auth.uid(),'planning') OR public.has_role(auth.uid(),'admin')) THEN
    RAISE EXCEPTION 'Somente Planejamento ou Administrador pode ativar uma semana.';
  END IF;
  SELECT worksite_id INTO target_worksite_id FROM public.weeks WHERE id=p_week_id;
  IF target_worksite_id IS NULL THEN RAISE EXCEPTION 'Semana não encontrada.'; END IF;
  IF NOT public.can_access_worksite(auth.uid(),target_worksite_id) THEN RAISE EXCEPTION 'A semana pertence a outra obra.'; END IF;

  UPDATE public.weeks
  SET is_active=false, lifecycle_status='closed', closed_at=now(),
      sap_closure_status='open',
      sap_closure_deadline=coalesce(sap_closure_deadline,
        ((end_date + ((8-extract(isodow FROM end_date)::integer)%7))::date::timestamp + interval '12 hours')
          AT TIME ZONE 'America/Sao_Paulo')
  WHERE worksite_id=target_worksite_id AND is_active=true AND id<>p_week_id;

  UPDATE public.weeks
  SET is_active=true, lifecycle_status='operational', activated_by=auth.uid(), activated_at=now(), closed_at=NULL,
      sap_closure_status='open',
      sap_closure_deadline=coalesce(sap_closure_deadline,
        ((end_date + ((8-extract(isodow FROM end_date)::integer)%7))::date::timestamp + interval '12 hours')
          AT TIME ZONE 'America/Sao_Paulo')
  WHERE id=p_week_id AND worksite_id=target_worksite_id;
END; $$;

GRANT EXECUTE ON FUNCTION public.activate_operational_week(uuid) TO authenticated;

-- Protege qualquer importação feita pela aplicação, inclusive chamadas RPC diretas.
CREATE OR REPLACE FUNCTION public.enforce_open_sap_week_import()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE target_week public.weeks%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO target_week FROM public.weeks WHERE id=NEW.week_id;
  IF target_week.sap_closure_status='closed'
     OR (target_week.sap_closure_deadline IS NOT NULL AND now()>target_week.sap_closure_deadline) THEN
    RAISE EXCEPTION 'O fechamento SAP desta semana está encerrado. Solicite a reabertura ou prorrogação ao administrador.';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS enforce_open_sap_week_import_trigger ON public.sap_confirmation_imports;
CREATE TRIGGER enforce_open_sap_week_import_trigger
BEFORE INSERT ON public.sap_confirmation_imports
FOR EACH ROW EXECUTE FUNCTION public.enforce_open_sap_week_import();

-- Usa o prazo administrável no comparativo e considera o fechamento manual.
CREATE OR REPLACE FUNCTION public.get_sap_confirmation_overview(p_week_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
WITH selected_week AS (
  SELECT w.*,
    coalesce(w.sap_closure_deadline,
        ((w.end_date+((8-extract(isodow FROM w.end_date)::integer)%7))::date::timestamp+interval '12 hours')
          AT TIME ZONE 'America/Sao_Paulo') AS deadline
  FROM public.weeks w
  WHERE w.id=p_week_id AND public.can_access_sap(auth.uid())
    AND public.can_access_worksite(auth.uid(),w.worksite_id)
), latest_import AS (
  SELECT i.id,i.row_count FROM public.sap_confirmation_imports i
  JOIN selected_week w ON w.id=i.week_id AND w.worksite_id=i.worksite_id
  WHERE EXISTS (SELECT 1 FROM public.sap_confirmation_rows r WHERE r.import_id=i.id)
  ORDER BY i.imported_at DESC,i.id DESC LIMIT 1
), activity_base AS (
  SELECT a.*,
    nullif(btrim(coalesce(a.planning_data->>'Confirmação',a.planning_data->>'Confirmacao','')),'') activity_confirmation,
    nullif(regexp_replace(btrim(coalesce(a.planning_data->>'Op',a.planning_data->>'Operação','')),'^0+',''),'') activity_operation,
    nullif(regexp_replace(btrim(coalesce(a.planning_data->>'Subop',a.planning_data->>'Suboperação','')),'^0+',''),'') activity_suboperation
  FROM public.activities a JOIN selected_week w ON w.id=a.week_id AND w.worksite_id=a.worksite_id
), matched AS (
  SELECT a.id activity_id,a.status operational_status,a.is_immediate,a.sap_status_snapshot,
    s.id sap_row_id,s.has_confirmation,coalesce(s.actual_work,0) actual_work,
    row_number() OVER (PARTITION BY a.id ORDER BY
      CASE WHEN a.activity_confirmation IS NOT NULL AND s.confirmation=a.activity_confirmation THEN 0 ELSE 1 END,
      CASE WHEN a.scheduled_date=s.actual_end_date THEN 0 ELSE 1 END,s.source_row_number) match_rank
  FROM activity_base a LEFT JOIN public.sap_confirmation_rows s
    ON s.import_id=(SELECT id FROM latest_import) AND s.order_number=a.order_number
   AND nullif(regexp_replace(btrim(coalesce(s.operation,'')),'^0+',''),'') IS NOT DISTINCT FROM a.activity_operation
   AND (a.activity_suboperation IS NULL OR
     nullif(regexp_replace(btrim(coalesce(s.suboperation,'')),'^0+',''),'') IS NOT DISTINCT FROM a.activity_suboperation)
), classified AS (
  SELECT m.activity_id,m.sap_row_id,m.actual_work,
    CASE
      WHEN NOT EXISTS (SELECT 1 FROM latest_import) THEN m.sap_status_snapshot
      WHEN m.operational_status IN ('NÃO EXECUTADO','CANCELADA') AND coalesce(m.has_confirmation,false) THEN 'Divergência'
      WHEN coalesce(m.has_confirmation,false) AND m.actual_work>0 THEN 'Confirmada no SAP'
      WHEN coalesce(m.has_confirmation,false) THEN 'Confirmada sem HH'
      WHEN m.operational_status IN ('NÃO EXECUTADO','CANCELADA') THEN 'Confirmação não esperada'
      WHEN (SELECT sap_closure_status FROM selected_week)='closed' THEN 'Não confirmada no SAP'
      WHEN now()<=(SELECT deadline FROM selected_week) THEN 'Aguardando confirmação'
      ELSE 'Não confirmada no SAP' END sap_status
  FROM matched m WHERE m.match_rank=1
    AND (EXISTS (SELECT 1 FROM latest_import) OR m.sap_status_snapshot IS NOT NULL)
), linked_sap AS (
  SELECT DISTINCT sap_row_id FROM classified WHERE sap_row_id IS NOT NULL
), unprogrammed AS (
  SELECT s.id,s.order_number,s.operation,s.suboperation,s.description,s.actual_start_date,s.actual_end_date,
    s.actual_work,s.confirmation,s.planning_code,
    CASE WHEN nullif(regexp_replace(regexp_replace(btrim(coalesce(s.planning_code,'')),'([,.]0+)$','','g'),'^0+',''),'')='2'
      THEN 'IMEDIATA' ELSE 'NÃO PROGRAMADA' END classification,
    'Confirmada no SAP'::text sap_status
  FROM public.sap_confirmation_rows s WHERE s.import_id=(SELECT id FROM latest_import)
    AND s.has_confirmation AND coalesce(s.actual_work,0)>0
    AND nullif(regexp_replace(regexp_replace(btrim(coalesce(s.planning_code,'')),'([,.]0+)$','','g'),'^0+',''),'') IN ('1','2')
    AND NOT EXISTS (SELECT 1 FROM linked_sap l WHERE l.sap_row_id=s.id)
), counts AS (
  SELECT sap_status,count(*)::integer total FROM classified GROUP BY sap_status
)
SELECT jsonb_build_object(
  'deadline',(SELECT deadline FROM selected_week),
  'closureStatus',(SELECT sap_closure_status FROM selected_week),
  'hasImport',EXISTS(SELECT 1 FROM latest_import) OR EXISTS(SELECT 1 FROM classified),
  'isSnapshot',NOT EXISTS(SELECT 1 FROM latest_import) AND EXISTS(SELECT 1 FROM classified),
  'importedRows',coalesce((SELECT row_count FROM latest_import),(SELECT count(*) FROM classified),0),
  'statuses',coalesce((SELECT jsonb_object_agg(activity_id,sap_status) FROM classified),'{}'::jsonb),
  'hours',coalesce((SELECT jsonb_object_agg(activity_id,actual_work) FROM classified WHERE sap_row_id IS NOT NULL),'{}'::jsonb),
  'counts',coalesce((SELECT jsonb_object_agg(sap_status,total) FROM counts),'{}'::jsonb),
  'unprogrammedCount',(SELECT count(*) FROM unprogrammed WHERE classification='NÃO PROGRAMADA'),
  'immediateCount',(SELECT count(*) FROM unprogrammed WHERE classification='IMEDIATA'),
  'unprogrammed',coalesce((SELECT jsonb_agg(to_jsonb(u) ORDER BY u.actual_end_date,u.order_number,u.operation) FROM unprogrammed u),'[]'::jsonb)
) FROM selected_week;
$$;

REVOKE ALL ON FUNCTION public.get_sap_confirmation_overview(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sap_confirmation_overview(uuid) TO authenticated;
