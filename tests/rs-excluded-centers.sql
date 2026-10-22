-- Database-owner integration test. All synthetic evidence/capacity is rolled back.
BEGIN;
SELECT set_config('request.jwt.claim.sub','b8b97321-11db-430e-b6b5-40b3cb15f307',true);
DO $setup$
DECLARE w public.weeks%ROWTYPE; code text; fixture jsonb:='[]'; baseline jsonb;
BEGIN
  SELECT * INTO w FROM public.weeks WHERE id='eea7fc13-1bfd-4117-b315-257fd1db1ea5';
  baseline:=public.get_weekly_rs_analysis(w.id,NULL);
  PERFORM set_config('test.rsx_baseline',baseline::text,true);
  FOREACH code IN ARRAY ARRAY['INSPPINT','TECNIEND','TECNINSC','HIDROJATO','RSX_ELIGIBLE'] LOOP
    fixture:=fixture||jsonb_build_array(jsonb_build_object('center',code,'date',w.start_date,'hours',100,
      'local','ROTINA','specialty','Caldeiraria','week','042-2026'));
    INSERT INTO public.activities(week_id,worksite_id,source_key,order_number,description,scheduled_date,status,planning_data)
    VALUES(w.id,w.worksite_id,'RSX-TEST-'||gen_random_uuid(),'RSX-TEST','Teste exclusão RS',w.start_date,'EXECUTADO',
      jsonb_build_object('CenTrab',code,'Trab',10,'Local','ROTINA','Confirmação','RSX-TEST-'||gen_random_uuid()));
  END LOOP;
  UPDATE public.weekly_rs_availability SET rows=rows||fixture WHERE week_id=w.id;
END $setup$;
SET LOCAL ROLE authenticated;
DO $test$
DECLARE a jsonb; base jsonb:=current_setting('test.rsx_baseline')::jsonb; pending jsonb;
BEGIN
  a:=public.get_weekly_rs_analysis('eea7fc13-1bfd-4117-b315-257fd1db1ea5',NULL);
  IF (a->'pendingSummary'->>'programmed')::int<>(base->'pendingSummary'->>'programmed')::int+1 THEN
    RAISE EXCEPTION 'Centros excluídos entraram na contagem RS'; END IF;
  IF (a->'pendingSummary'->>'monitoringTasks')::int<>(base->'pendingSummary'->>'monitoringTasks')::int+4 THEN
    RAISE EXCEPTION 'Acompanhamento não preservado'; END IF;
  pending:=public.get_weekly_rs_pending('eea7fc13-1bfd-4117-b315-257fd1db1ea5',NULL,0,50,NULL,false,false,'RSX-TEST');
  IF (pending->>'total')::int<>1 THEN RAISE EXCEPTION 'Lista RS incluiu centro excluído'; END IF;
  pending:=public.get_weekly_rs_pending('eea7fc13-1bfd-4117-b315-257fd1db1ea5',NULL,0,50,NULL,false,true,'RSX-TEST');
  IF (pending->>'total')::int<>5 THEN RAISE EXCEPTION 'Lista de acompanhamento não preservada'; END IF;
  IF has_function_privilege('authenticated','public.weekly_rs_included(text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'Helper interno exposto'; END IF;
END $test$;
ROLLBACK;
