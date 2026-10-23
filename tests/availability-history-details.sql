-- Synthetic snapshots exist only inside this rolled-back transaction.
BEGIN;
SELECT set_config('request.jwt.claim.sub','b8b97321-11db-430e-b6b5-40b3cb15f307',true);
DO $test$
DECLARE w uuid:='eea7fc13-1bfd-4117-b315-257fd1db1ea5'; site uuid; v integer; old_rows jsonb; new_rows jsonb; result jsonb;
BEGIN
  SELECT worksite_id INTO site FROM public.weeks WHERE id=w;
  SELECT max(version)+100 INTO v FROM public.weekly_rs_availability_history WHERE week_id=w;
  old_rows:='[{"center":"A","date":"2026-10-13","hours":10,"local":"ROTINA","specialty":"CALD","week":"042-2026"},{"center":"B","date":"2026-10-13","hours":20,"local":"ROTINA","specialty":"CALD","week":"042-2026"},{"center":"C","date":"2026-10-13","hours":30,"local":"ROTINA","specialty":"CALD","week":"042-2026"}]';
  new_rows:='[{"center":"C","date":"2026-10-13","hours":30,"local":"ROTINA","specialty":"CALD","week":"042-2026"},{"center":"A","date":"2026-10-13","hours":10,"local":"IARI","specialty":"ANDAIME","week":"042-2026"},{"center":"D","date":"2026-10-14","hours":20,"local":"ROTINA","specialty":"CALD","week":"042-2026"}]';
  INSERT INTO public.weekly_rs_availability_history(week_id,worksite_id,version,rows,updated_by)
    VALUES(w,site,v,old_rows,auth.uid()),(w,site,v+1,new_rows,auth.uid()),(w,site,v+2,new_rows,auth.uid()),(w,site,v+10,new_rows,auth.uid());
  result:=public.get_weekly_rs_availability_changes(w,v+1,0,50);
  IF (result->>'total')::int<>3 OR (result->>'included')::int<>1 OR (result->>'removed')::int<>1 OR (result->>'updated')::int<>1 THEN RAISE EXCEPTION 'Diferenças incorretas: %',result; END IF;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(result->'rows') r WHERE r->>'center'='A' AND r->'before'->>'hours'=r->'after'->>'hours' AND r->'after'->>'local'='IARI' AND r->'after'->>'specialty'='ANDAIME') THEN RAISE EXCEPTION 'Mudança sem alterar HH não identificada'; END IF;
  result:=public.get_weekly_rs_availability_changes(w,v+1,1,1);
  IF jsonb_array_length(result->'rows')<>1 OR (result->>'total')::int<>3 THEN RAISE EXCEPTION 'Paginação incorreta'; END IF;
  result:=public.get_weekly_rs_availability_changes(w,v+2,0,50);
  IF (result->>'total')::int<>0 THEN RAISE EXCEPTION 'Salvamento sem mudança gerou alterações'; END IF;
  result:=public.get_weekly_rs_availability_changes(w,v+10,0,50);
  IF (result->>'comparisonAvailable')::boolean THEN RAISE EXCEPTION 'Antecessor ausente virou cadastro inicial'; END IF;
  result:=public.get_weekly_rs_availability_changes(w,1,0,1);
  IF NOT (result->>'comparisonAvailable')::boolean OR (result->>'updated')::int<>0 OR (result->>'removed')::int<>0 THEN RAISE EXCEPTION 'Cadastro inicial incorreto'; END IF;
  PERFORM set_config('request.jwt.claim.sub','006ec110-72eb-4aa2-aa78-6834bc5ea40d',true);
  BEGIN
    PERFORM public.get_weekly_rs_availability_changes(w,v+1,0,50);
    RAISE EXCEPTION 'ROLE_LEAK';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='ROLE_LEAK' THEN RAISE; END IF;
  END;
END $test$;
ROLLBACK;
