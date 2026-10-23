-- Synthetic integration rows and every assertion are rolled back.
BEGIN;
SELECT set_config('request.jwt.claim.sub','b8b97321-11db-430e-b6b5-40b3cb15f307',true);
DO $test$
DECLARE w public.weeks%ROWTYPE; imp uuid; prefix text:='EARNED-TEST-'||gen_random_uuid();
  n integer; ids uuid[]:='{}'; a uuid; value numeric; result jsonb;
BEGIN
  SELECT * INTO w FROM public.weeks WHERE id='eea7fc13-1bfd-4117-b315-257fd1db1ea5';
  SELECT id INTO imp FROM public.sap_confirmation_imports WHERE week_id=w.id AND EXISTS(
    SELECT 1 FROM public.sap_confirmation_rows WHERE import_id=sap_confirmation_imports.id) ORDER BY imported_at DESC,id DESC LIMIT 1;
  FOR n IN 0..2 LOOP
    INSERT INTO public.activities(week_id,worksite_id,source_key,order_number,description,scheduled_date,status,justification,planning_data)
    VALUES(w.id,w.worksite_id,prefix||n,'EARNED-TEST','Teste avanço SAP',w.start_date+n,
      CASE WHEN n=0 THEN 'NÃO EXECUTADO' WHEN n=1 THEN 'EXECUTADO' ELSE 'Sem apontamento' END,
      CASE WHEN n=0 THEN 'Teste de apontamento' END,
      jsonb_build_object('CenTrab','TEST_EARNED','Trab',35.2,'Confirmação',prefix)) RETURNING id INTO a;
    ids:=array_append(ids,a);
  END LOOP;
  INSERT INTO public.sap_confirmation_rows(import_id,week_id,worksite_id,source_row_number,order_number,confirmation,system_status,actual_work,actual_start_date,actual_end_date)
  VALUES(imp,w.id,w.worksite_id,2147482900,'EARNED-TEST',prefix,'CONF',70.4,w.start_date,w.start_date+1);
  SELECT sum(earned) INTO value FROM public.activity_sap_earned(w.id) WHERE activity_id=ANY(ids);
  IF abs(value-70.4)>0.000001 THEN RAISE EXCEPTION 'Duplicação de apropriação: %',value; END IF;
  SELECT earned INTO value FROM public.activity_sap_earned(w.id) WHERE activity_id=ids[3];
  IF value<>0 THEN RAISE EXCEPTION 'Dia sem apropriação recebeu HH'; END IF;
  result:=public.get_activities_page(w.id,jsonb_build_object('search','EARNED-TEST','dates',jsonb_build_array(w.start_date)),0,1);
  IF abs((result->'progress'->>'earned')::numeric-35.2)>0.000001 OR (result->'progress'->>'percent')::numeric<>100 THEN RAISE EXCEPTION 'Filtro ou paginação alterou crédito: %',result->'progress'; END IF;
  -- Additional overlapping appropriations may not exceed any task's planned HH.
  INSERT INTO public.sap_confirmation_rows(import_id,week_id,worksite_id,source_row_number,order_number,confirmation,system_status,actual_work,actual_start_date,actual_end_date)
  VALUES(imp,w.id,w.worksite_id,2147482901,'EARNED-TEST',prefix,'CONF',200,w.start_date,w.start_date+2);
  SELECT sum(earned) INTO value FROM public.activity_sap_earned(w.id) WHERE activity_id=ANY(ids);
  IF abs(value-105.6)>0.000001 THEN RAISE EXCEPTION 'Teto incorreto: %',value; END IF;
  -- Unknown execution dates must not confirm another day.
  INSERT INTO public.activities(week_id,worksite_id,source_key,order_number,description,scheduled_date,status,planning_data)
  VALUES(w.id,w.worksite_id,prefix||'unknown','EARNED-TEST','Teste sem data',w.start_date,'EXECUTADO',jsonb_build_object('Trab',10,'Confirmação',prefix||'unknown')) RETURNING id INTO a;
  INSERT INTO public.sap_confirmation_rows(import_id,week_id,worksite_id,source_row_number,order_number,confirmation,system_status,actual_work)
  VALUES(imp,w.id,w.worksite_id,2147482902,'EARNED-TEST',prefix||'unknown','CONF',10);
  SELECT earned INTO value FROM public.activity_sap_earned(w.id) WHERE activity_id=a;
  IF value<>0 THEN RAISE EXCEPTION 'SAP sem data distribuído indevidamente'; END IF;
  IF (SELECT status FROM public.activities WHERE id=ids[1])<>'NÃO EXECUTADO' THEN RAISE EXCEPTION 'Status operacional alterado'; END IF;
END $test$;
ROLLBACK;
