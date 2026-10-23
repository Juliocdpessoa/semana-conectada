BEGIN;
SELECT set_config('request.jwt.claim.sub','b8b97321-11db-430e-b6b5-40b3cb15f307',true);
DO $test$
DECLARE w uuid:='c4112977-cc67-47f4-b609-7ce06240c61a'; summary jsonb; row_id uuid;
BEGIN
  summary:=public.get_activity_sap_progress(w);
  IF (summary->>'invalidHours')::integer<>0 THEN RAISE EXCEPTION 'Linhas vazias ainda bloqueiam a curva: %',summary; END IF;
  IF (summary->>'planned')::numeric<>17105.5 THEN RAISE EXCEPTION 'HH programado mudou ao ignorar vazios'; END IF;
  IF EXISTS(SELECT 1 FROM public.activity_sap_earned(w) WHERE progress_date IS NULL) THEN RAISE EXCEPTION 'Linha vazia entrou no gráfico'; END IF;
  INSERT INTO public.activities(week_id,worksite_id,source_key,order_number,description,scheduled_date,status,planning_data)
  SELECT id,worksite_id,'EMPTY-PROGRESS-TEST-'||gen_random_uuid(),'EMPTY-PROGRESS-TEST','Tarefa real sem HH',start_date,'Sem apontamento','{}'::jsonb FROM public.weeks WHERE id=w RETURNING id INTO row_id;
  summary:=public.get_activity_sap_progress(w);
  IF (summary->>'invalidHours')::integer<>1 THEN RAISE EXCEPTION 'Tarefa real sem HH foi omitida'; END IF;
END $test$;
ROLLBACK;
