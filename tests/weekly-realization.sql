-- Configure request.jwt.claim.sub to an approved planning/admin first.
-- The availability writes and their audit history are rolled back.
BEGIN;
SET LOCAL ROLE authenticated;
DO $test$
DECLARE week uuid; result jsonb; baseline numeric; version int; code text; start_day date; entries jsonb; record_count int;
BEGIN
  SELECT id,start_date INTO week,start_day FROM public.weeks WHERE is_active LIMIT 1;
  IF week IS NULL THEN RAISE EXCEPTION 'Semana operacional não encontrada'; END IF;
  result:=public.get_weekly_realization(week);
  IF result->'source' IS DISTINCT FROM 'null'::jsonb THEN
    SELECT coalesce(sum(actual_work),0) INTO baseline FROM public.sap_confirmation_rows
      WHERE import_id=(result->'source'->>'id')::uuid AND has_confirmation AND actual_work>0;
    IF baseline<>(result->>'completed')::numeric+(result->>'immediate')::numeric+(result->>'unprogrammed')::numeric+(result->>'unclassified')::numeric THEN
      RAISE EXCEPTION 'Horas duplicadas ou perdidas na classificação';
    END IF;
    IF (SELECT sum((x->>'programmed')::numeric) FROM jsonb_array_elements(result->'centers') x) IS DISTINCT FROM (result->>'programmed')::numeric
      OR (SELECT sum((x->>'completed')::numeric) FROM jsonb_array_elements(result->'centers') x) IS DISTINCT FROM (result->>'completed')::numeric
      OR (SELECT sum((x->>'immediate')::numeric) FROM jsonb_array_elements(result->'centers') x) IS DISTINCT FROM (result->>'immediate')::numeric THEN
      RAISE EXCEPTION 'Agregação por centro não reconciliada';
    END IF;
  ELSIF result->'completed' IS DISTINCT FROM 'null'::jsonb OR result->'immediate' IS DISTINCT FROM 'null'::jsonb THEN
    RAISE EXCEPTION 'Carga ausente convertida em zero';
  END IF;
  SELECT lpad(substring(w.code from '^([0-9]{1,3})'),3,'0')||'-'||substring(w.code from '^[0-9]{1,3}[-/]([0-9]{4})') INTO code FROM public.weeks w WHERE id=week;
  version:=coalesce((result->'availability'->>'version')::int,0);
  entries:=jsonb_build_array(jsonb_build_object('center','CALD','date',start_day,'hours',35.2,'week',code,'local','ROTINA','specialty','Caldeiraria'));
  SELECT count(*) INTO record_count FROM public.weekly_rs_availability_history WHERE week_id=week;
  PERFORM public.save_weekly_rs_availability(week,entries,version,'Teste transacional');
  result:=public.get_weekly_realization(week);
  IF (result->'availability'->'rows'->0->>'hours')::numeric<>35.2 OR (result->'availability'->>'version')::int<>version+1 THEN
    RAISE EXCEPTION 'Disponibilidade não persistida';
  END IF;
  IF (SELECT count(*) FROM public.weekly_rs_availability_history WHERE week_id=week)<>record_count+1 THEN RAISE EXCEPTION 'Histórico ausente'; END IF;
  BEGIN
    PERFORM public.save_weekly_rs_availability(week,entries,version,NULL);
    RAISE EXCEPTION 'Conflito de versão não detectado';
  EXCEPTION WHEN serialization_failure THEN NULL; END;
  BEGIN
    PERFORM public.save_weekly_rs_availability(week,entries||entries,version+1,NULL);
    RAISE EXCEPTION 'Duplicata aceita' USING ERRCODE='ZX001';
  EXCEPTION WHEN raise_exception THEN NULL; END;
  BEGIN
    PERFORM public.save_weekly_rs_availability(week,jsonb_set(entries,'{0,hours}','-1'),version+1,NULL);
    RAISE EXCEPTION 'Horas negativas aceitas' USING ERRCODE='ZX001';
  EXCEPTION WHEN raise_exception THEN NULL; END;
  BEGIN
    PERFORM public.save_weekly_rs_availability(week,jsonb_set(entries,'{0,date}','"2000-01-01"'),version+1,NULL);
    RAISE EXCEPTION 'Data fora da semana aceita' USING ERRCODE='ZX001';
  EXCEPTION WHEN raise_exception THEN NULL; END;
  BEGIN
    PERFORM public.save_weekly_rs_availability(week,jsonb_set(entries,'{0,week}','"999-2000"'),version+1,NULL);
    RAISE EXCEPTION 'Semana incorreta aceita' USING ERRCODE='ZX001';
  EXCEPTION WHEN raise_exception THEN NULL; END;
  PERFORM public.save_weekly_rs_availability(week,jsonb_set(entries,'{0,hours}','0'),version+1,'Zero disponível explícito');
  IF (SELECT count(*) FROM public.weekly_rs_availability_history WHERE week_id=week)<>record_count+2 THEN RAISE EXCEPTION 'Auditoria de alteração ausente'; END IF;
END $test$;
ROLLBACK;
