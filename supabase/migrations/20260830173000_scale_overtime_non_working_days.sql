-- Em fins de semana e feriados, toda a jornada da mudança de escala é hora extra.
-- Feriados específicos de uma obra podem ser adicionados sem alterar o código.
CREATE TABLE IF NOT EXISTS public.worksite_holidays (
  worksite_id uuid NOT NULL REFERENCES public.worksites(id) ON DELETE CASCADE,
  holiday_date date NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (worksite_id, holiday_date)
);
ALTER TABLE public.worksite_holidays ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.worksite_holidays TO authenticated;
GRANT ALL ON public.worksite_holidays TO service_role;
CREATE POLICY "holidays within worksite" ON public.worksite_holidays FOR SELECT TO authenticated
USING (public.can_access_worksite(auth.uid(), worksite_id));

CREATE OR REPLACE FUNCTION public.brazil_easter_date(p_year integer)
RETURNS date LANGUAGE plpgsql IMMUTABLE STRICT SET search_path = public AS $$
DECLARE a int; b int; c int; d int; e int; f int; g int; h int; i int; k int; l int; m int; month_n int; day_n int;
BEGIN
  a:=p_year%19; b:=p_year/100; c:=p_year%100; d:=b/4; e:=b%4;
  f:=(b+8)/25; g:=(b-f+1)/3; h:=(19*a+b-d-g+15)%30;
  i:=c/4; k:=c%4; l:=(32+2*e+2*i-h-k)%7; m:=(a+11*h+22*l)/451;
  month_n:=(h+l-7*m+114)/31; day_n:=((h+l-7*m+114)%31)+1;
  RETURN make_date(p_year,month_n,day_n);
END; $$;

CREATE OR REPLACE FUNCTION public.is_scale_non_working_day(p_date date, p_worksite_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT extract(isodow FROM p_date) IN (6,7)
    OR to_char(p_date,'MM-DD') IN ('01-01','04-21','05-01','09-07','10-12','11-02','11-15','11-20','12-25')
    OR p_date IN (
      public.brazil_easter_date(extract(year FROM p_date)::int) - 47,
      public.brazil_easter_date(extract(year FROM p_date)::int) - 2,
      public.brazil_easter_date(extract(year FROM p_date)::int) + 60
    )
    OR EXISTS (SELECT 1 FROM public.worksite_holidays h WHERE h.worksite_id=p_worksite_id AND h.holiday_date=p_date)
$$;

CREATE OR REPLACE FUNCTION public.sync_overtime_from_scale_row(p_scale public.scheduled_transport_requests)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_entry_minutes integer; v_departure_minutes integer; v_regular_end_minutes integer;
  v_extra_entry text; v_group_hash text; v_group_id uuid; v_manual_duplicate boolean;
  v_existing public.overtime_requests%ROWTYPE; v_changed boolean; v_non_working boolean;
  v_justification text;
BEGIN
  IF p_scale.status <> 'scheduled' OR p_scale.requester_user_id IS NULL THEN
    UPDATE public.overtime_requests SET status='cancelled',version=version+1,updated_at=now()
    WHERE source_scheduled_transport_id=p_scale.id AND status<>'cancelled'; RETURN;
  END IF;
  v_entry_minutes:=split_part(p_scale.entry_time,':',1)::int*60+split_part(p_scale.entry_time,':',2)::int;
  v_departure_minutes:=split_part(p_scale.departure_time,':',1)::int*60+split_part(p_scale.departure_time,':',2)::int;
  IF v_departure_minutes<=v_entry_minutes THEN v_departure_minutes:=v_departure_minutes+1440; END IF;
  v_non_working:=public.is_scale_non_working_day(p_scale.transport_date,p_scale.worksite_id);
  v_regular_end_minutes:=v_entry_minutes+588;
  IF NOT v_non_working AND v_departure_minutes<=v_regular_end_minutes THEN
    UPDATE public.overtime_requests SET status='cancelled',version=version+1,updated_at=now()
    WHERE source_scheduled_transport_id=p_scale.id AND status<>'cancelled'; RETURN;
  END IF;
  IF v_non_working THEN
    v_extra_entry:=p_scale.entry_time;
    v_justification:='Jornada integral automática em final de semana ou feriado.';
  ELSE
    v_extra_entry:=lpad(((v_regular_end_minutes%1440)/60)::text,2,'0')||':'||lpad((v_regular_end_minutes%60)::text,2,'0');
    v_justification:='Excedente automático da jornada de 8h48 com 1h de refeição.';
  END IF;
  SELECT EXISTS(SELECT 1 FROM public.overtime_requests ot
    WHERE ot.worksite_id=p_scale.worksite_id AND ot.employee_master_id=p_scale.employee_master_id
      AND ot.overtime_date=p_scale.transport_date AND ot.entry_time=v_extra_entry
      AND ot.departure_time=p_scale.departure_time AND ot.status<>'cancelled'
      AND ot.source_scheduled_transport_id IS NULL) INTO v_manual_duplicate;
  SELECT * INTO v_existing FROM public.overtime_requests WHERE source_scheduled_transport_id=p_scale.id LIMIT 1;
  IF v_manual_duplicate THEN
    IF v_existing.id IS NOT NULL AND v_existing.status<>'cancelled' THEN
      UPDATE public.overtime_requests SET status='cancelled',version=version+1,updated_at=now() WHERE id=v_existing.id;
    END IF; RETURN;
  END IF;
  v_group_hash:=md5(coalesce(p_scale.batch_id::text,p_scale.id::text)||'|'||p_scale.transport_date::text);
  v_group_id:=(substr(v_group_hash,1,8)||'-'||substr(v_group_hash,9,4)||'-'||substr(v_group_hash,13,4)||'-'||substr(v_group_hash,17,4)||'-'||substr(v_group_hash,21,12))::uuid;
  IF v_existing.id IS NULL THEN
    INSERT INTO public.overtime_requests(worksite_id,batch_id,requester_user_id,requester_name,requester_email,
      employee_master_id,employee_external_id,employee_name,employee_registration,employee_role,order_number,
      service_description,overtime_date,entry_time,departure_time,needs_snack,needs_transport,justification,status,
      source_type,source_scheduled_transport_id)
    VALUES(p_scale.worksite_id,v_group_id,p_scale.requester_user_id,p_scale.requester_name,p_scale.requester_email,
      p_scale.employee_master_id,p_scale.employee_external_id,p_scale.employee_name,coalesce(p_scale.employee_registration,''),
      p_scale.employee_role,p_scale.order_number,coalesce(nullif(trim(p_scale.service_description),''),'Mudança de escala'),
      p_scale.transport_date,v_extra_entry,p_scale.departure_time,false,false,v_justification,'pending','scale_change',p_scale.id);
    RETURN;
  END IF;
  v_changed:=v_existing.worksite_id IS DISTINCT FROM p_scale.worksite_id OR v_existing.batch_id IS DISTINCT FROM v_group_id
    OR v_existing.employee_master_id IS DISTINCT FROM p_scale.employee_master_id
    OR v_existing.overtime_date IS DISTINCT FROM p_scale.transport_date OR v_existing.entry_time IS DISTINCT FROM v_extra_entry
    OR v_existing.departure_time IS DISTINCT FROM p_scale.departure_time OR v_existing.justification IS DISTINCT FROM v_justification;
  UPDATE public.overtime_requests SET worksite_id=p_scale.worksite_id,batch_id=v_group_id,
    requester_user_id=p_scale.requester_user_id,requester_name=p_scale.requester_name,requester_email=p_scale.requester_email,
    employee_master_id=p_scale.employee_master_id,employee_external_id=p_scale.employee_external_id,
    employee_name=p_scale.employee_name,employee_registration=coalesce(p_scale.employee_registration,''),employee_role=p_scale.employee_role,
    order_number=p_scale.order_number,service_description=coalesce(nullif(trim(p_scale.service_description),''),'Mudança de escala'),
    overtime_date=p_scale.transport_date,entry_time=v_extra_entry,departure_time=p_scale.departure_time,
    needs_snack=false,needs_transport=false,justification=v_justification,source_type='scale_change',
    status=CASE WHEN v_changed OR v_existing.status='cancelled' THEN 'pending' ELSE v_existing.status END,
    manager_comment=CASE WHEN v_changed OR v_existing.status='cancelled' THEN NULL ELSE v_existing.manager_comment END,
    decided_by_user_id=CASE WHEN v_changed OR v_existing.status='cancelled' THEN NULL ELSE v_existing.decided_by_user_id END,
    decided_by_name=CASE WHEN v_changed OR v_existing.status='cancelled' THEN NULL ELSE v_existing.decided_by_name END,
    decided_by_email=CASE WHEN v_changed OR v_existing.status='cancelled' THEN NULL ELSE v_existing.decided_by_email END,
    decided_at=CASE WHEN v_changed OR v_existing.status='cancelled' THEN NULL ELSE v_existing.decided_at END,
    version=CASE WHEN v_changed OR v_existing.status='cancelled' THEN v_existing.version+1 ELSE v_existing.version END,
    updated_at=CASE WHEN v_changed OR v_existing.status='cancelled' THEN now() ELSE v_existing.updated_at END
  WHERE id=v_existing.id;
END; $$;

-- Recalcula todos os registros existentes, inclusive os que antes não geravam extra.
DO $$ DECLARE r public.scheduled_transport_requests%ROWTYPE; BEGIN
  FOR r IN SELECT * FROM public.scheduled_transport_requests LOOP
    PERFORM public.sync_overtime_from_scale_row(r);
  END LOOP;
END $$;

