-- Run as database owner; all synthetic evidence and history are rolled back.
BEGIN;
DO $setup$
DECLARE w public.weeks%ROWTYPE; import_id uuid; confirmation text:='RS-TEST-'||gen_random_uuid(); offset_day int;
BEGIN
 SELECT * INTO w FROM public.weeks WHERE is_active ORDER BY start_date DESC LIMIT 1;
 SELECT i.id INTO import_id FROM public.sap_confirmation_imports i WHERE i.week_id=w.id AND i.worksite_id=w.worksite_id
   AND EXISTS(SELECT 1 FROM public.sap_confirmation_rows r WHERE r.import_id=i.id) ORDER BY i.imported_at DESC,i.id DESC LIMIT 1;
 IF import_id IS NULL THEN RAISE EXCEPTION 'Teste requer carga SAP na semana ativa'; END IF;
 PERFORM set_config('test.rs_week',w.id::text,true);
 PERFORM set_config('test.rs_confirmation',confirmation,true);
 FOR offset_day IN 0..2 LOOP
   INSERT INTO public.activities(week_id,worksite_id,source_key,order_number,description,scheduled_date,status,planning_data)
   VALUES(w.id,w.worksite_id,confirmation||'-'||offset_day,'RS-TEST','Teste transacional RS',w.start_date+offset_day,'EXECUTADO',
     jsonb_build_object('Confirmação',confirmation,'Trab','8,8','CenTrab','CALD','Local','ROTINA','Op','10'));
 END LOOP;
 INSERT INTO public.sap_confirmation_rows(import_id,week_id,worksite_id,source_row_number,order_number,confirmation,system_status,actual_work,actual_start_date,actual_end_date,work_center,planning_code)
 VALUES(import_id,w.id,w.worksite_id,2147483000,'RS-TEST',confirmation,'CONF',17.6,w.start_date+1,w.start_date+1,'CALD','1');
END $setup$;
-- Configure caller to an approved planning/admin before running this script.
SET LOCAL ROLE authenticated;
DO $test$
DECLARE w uuid:=current_setting('test.rs_week')::uuid; a jsonb; i jsonb; r jsonb; page jsonb;
BEGIN
 a:=public.get_weekly_rs_analysis(w,NULL); i:=public.get_weekly_rs_analysis(w,'IARI'); r:=public.get_weekly_rs_analysis(w,'ROTINA');
 IF (a->'pendingSummary'->>'pending')::int<>(i->'pendingSummary'->>'pending')::int+(r->'pendingSummary'->>'pending')::int THEN
   RAISE EXCEPTION 'Contagem dos locais não reconciliada'; END IF;
 IF (SELECT sum((x->>'tasks')::int) FROM jsonb_array_elements(a->'reasons') x)<>(a->'pendingSummary'->>'pending')::int THEN
   RAISE EXCEPTION 'Justificativas não reconciliadas'; END IF;
 page:=public.get_weekly_rs_pending(w,'ROTINA',0,50,NULL,false,false,current_setting('test.rs_confirmation'));
 IF (page->>'total')::int<>2 THEN RAISE EXCEPTION 'Confirmação parcial confirmou dias indevidos'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(page->'rows') x WHERE x->>'sap_state'<>'sem_apropriacao') THEN
   RAISE EXCEPTION 'Estado de apropriação inconsistente'; END IF;
 BEGIN PERFORM public.get_weekly_rs_analysis(w,'OUTRO'); RAISE EXCEPTION 'Local inválido aceito' USING ERRCODE='ZX001'; EXCEPTION WHEN raise_exception THEN NULL; END;
 BEGIN PERFORM public.weekly_rs_activity_evidence(w); RAISE EXCEPTION 'Helper privado exposto' USING ERRCODE='ZX001'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $test$;
ROLLBACK;
