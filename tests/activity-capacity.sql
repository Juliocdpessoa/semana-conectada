-- Database-owner test. Synthetic rows and availability are always rolled back.
BEGIN;
SELECT set_config('request.jwt.claim.sub','b8b97321-11db-430e-b6b5-40b3cb15f307',true);
DO $setup$
DECLARE w public.weeks%ROWTYPE; fixture jsonb; prefix text:='CAP-TEST-'||gen_random_uuid();
BEGIN
  SELECT * INTO w FROM public.weeks WHERE id='c4112977-cc67-47f4-b609-7ce06240c61a';
  fixture:=jsonb_build_array(
    jsonb_build_object('center','CAP_TEST_MAIN','date',w.start_date,'hours',80,'local','ROTINA','specialty','Teste','week','043-2026'),
    jsonb_build_object('center','CAP_TEST_MAIN','date',w.start_date,'hours',8,'local','IARI','specialty','Teste','week','043-2026'),
    jsonb_build_object('center','CAP_TEST_MAIN','date',w.start_date+1,'hours',88,'local','ROTINA','specialty','Teste','week','043-2026'),
    jsonb_build_object('center','CAP_TEST_ZERO','date',w.start_date,'hours',0,'local','ROTINA','specialty','Alpinismo','week','043-2026'));
  INSERT INTO public.weekly_rs_availability(week_id,worksite_id,rows,updated_by)
  VALUES(w.id,w.worksite_id,fixture,auth.uid())
  ON CONFLICT(week_id) DO UPDATE SET rows=public.weekly_rs_availability.rows||excluded.rows;
  INSERT INTO public.activities(week_id,worksite_id,source_key,order_number,description,scheduled_date,status,is_immediate,planning_data,justification)
  VALUES
    (w.id,w.worksite_id,prefix||'1','CAP-TEST','Capacidade teste',w.start_date,'Sem apontamento',false,'{"CenTrab":"CAP_TEST_MAIN","Trab":"105,6"}',null),
    (w.id,w.worksite_id,prefix||'2','CAP-TEST','Cancelada não consome',w.start_date,'CANCELADA',false,'{"CenTrab":"CAP_TEST_MAIN","Trab":1000}','12 - SERVIÇO CANCELADO'),
    (w.id,w.worksite_id,prefix||'3','CAP-TEST','Imediata consome',w.start_date,'Sem apontamento',true,'{"CenTrab":"CAP_TEST_ZERO","Trab":"8,8 horas"}',null),
    (w.id,w.worksite_id,prefix||'4','CAP-TEST','Base ausente',w.start_date,'Sem apontamento',false,'{"CenTrab":"CAP_TEST_MISSING","Trab":10}',null),
    (w.id,w.worksite_id,prefix||'5','CAP-TEST','HH inválido',w.start_date,'Sem apontamento',false,'{"CenTrab":"CAP_TEST_INVALID","Trab":"erro"}',null);
END $setup$;
SET LOCAL ROLE authenticated;
DO $test$
DECLARE snapshot jsonb; r jsonb; activity public.activities%ROWTYPE;
BEGIN
  snapshot:=public.get_activity_daily_capacity('c4112977-cc67-47f4-b609-7ce06240c61a');
  SELECT value INTO r FROM jsonb_array_elements(snapshot->'rows') WHERE value->>'center'='CAP_TEST_MAIN' AND value->>'date'='2026-10-19';
  IF (r->>'available')::numeric<>88 OR (r->>'programmed')::numeric<>105.6 OR (r->>'excess')::numeric<>17.6 OR (r->>'tasks')::int<>1 THEN
    RAISE EXCEPTION 'Soma local/carga/exclusão canceladas incorreta: %',r;
  END IF;
  SELECT value INTO r FROM jsonb_array_elements(snapshot->'rows') WHERE value->>'center'='CAP_TEST_ZERO';
  IF (r->>'excess')::numeric<>8.8 THEN RAISE EXCEPTION 'Zero explícito/imediata incorreto'; END IF;
  SELECT value INTO r FROM jsonb_array_elements(snapshot->'rows') WHERE value->>'center'='CAP_TEST_MISSING';
  IF r->>'available' IS NOT NULL OR r->>'excess' IS NOT NULL THEN RAISE EXCEPTION 'Ausência virou zero'; END IF;
  SELECT value INTO r FROM jsonb_array_elements(snapshot->'rows') WHERE value->>'center'='CAP_TEST_INVALID';
  IF (r->>'invalidHours')::int<>1 OR r->>'excess' IS NOT NULL THEN RAISE EXCEPTION 'HH inválido oculto'; END IF;
  SELECT * INTO activity FROM public.activities WHERE source_key LIKE 'CAP-TEST-%1' AND planning_data->>'CenTrab'='CAP_TEST_MAIN';
  PERFORM public.bulk_update_activity_planning_fields(jsonb_build_array(jsonb_build_object(
    'id',activity.id,'expected_version',activity.version,'pbs',activity.pbs,'pt_number',activity.pt_number,
    'pt_color',activity.pt_color,'release_type',activity.release_type,'scheduled_date','2026-10-20')));
  snapshot:=public.get_activity_daily_capacity(activity.week_id);
  SELECT value INTO r FROM jsonb_array_elements(snapshot->'rows') WHERE value->>'center'='CAP_TEST_MAIN' AND value->>'date'='2026-10-20';
  IF (r->>'excess')::numeric<>17.6 THEN RAISE EXCEPTION 'Movimentação não refletiu no destino: %',r; END IF;
  SELECT value INTO r FROM jsonb_array_elements(snapshot->'rows') WHERE value->>'center'='CAP_TEST_MAIN' AND value->>'date'='2026-10-19';
  IF (r->>'programmed')::numeric<>0 THEN RAISE EXCEPTION 'Movimentação não retirou carga da origem'; END IF;
  BEGIN
    PERFORM public.get_activity_daily_capacity('00000000-0000-0000-0000-000000000000');
    RAISE EXCEPTION 'Semana não autorizada aceita' USING ERRCODE='ZX001';
  EXCEPTION WHEN raise_exception THEN NULL; END;
END $test$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
DO $denied$
BEGIN
  BEGIN
    PERFORM public.get_activity_daily_capacity('c4112977-cc67-47f4-b609-7ce06240c61a');
    RAISE EXCEPTION 'Sem autenticação aceito' USING ERRCODE='ZX001';
  EXCEPTION WHEN raise_exception THEN NULL; END;
END $denied$;
ROLLBACK;
