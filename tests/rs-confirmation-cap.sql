-- Synthetic integration evidence is rolled back; official SAP rows are never updated/deleted.
BEGIN;
SELECT set_config('request.jwt.claim.sub','b8b97321-11db-430e-b6b5-40b3cb15f307',true);
DO $setup$
DECLARE w public.weeks%ROWTYPE; imp uuid; prefix text:='RSCC-TEST-'||gen_random_uuid(); n int:=0; item jsonb; day_offset int;
BEGIN
  SELECT * INTO w FROM public.weeks WHERE id='eea7fc13-1bfd-4117-b315-257fd1db1ea5';
  SELECT id INTO imp FROM public.sap_confirmation_imports WHERE week_id=w.id AND EXISTS(
    SELECT 1 FROM public.sap_confirmation_rows WHERE import_id=sap_confirmation_imports.id) ORDER BY imported_at DESC,id DESC LIMIT 1;
  IF imp IS NULL THEN RAISE EXCEPTION 'Teste requer carga SAP'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements('[
    {"code":"ONE","planned":17.6,"actual":35.2,"days":1},
    {"code":"PART","planned":35.2,"actual":8.8,"days":1},
    {"code":"MULTI","planned":17.6,"actual":105.6,"days":3},
    {"code":"OVER","center":"GROUP","planned":20,"actual":40,"days":1},
    {"code":"UNDER","center":"GROUP","planned":20,"actual":5,"days":1}
  ]'::jsonb) LOOP
    FOR day_offset IN 0..(item->>'days')::int-1 LOOP
      INSERT INTO public.activities(week_id,worksite_id,source_key,order_number,description,scheduled_date,status,planning_data)
      VALUES(w.id,w.worksite_id,prefix||(item->>'code')||day_offset,'RSCC-TEST','Teste teto por confirmação',w.start_date+day_offset,'EXECUTADO',
        jsonb_build_object('CenTrab','RSCC_'||coalesce(item->>'center',item->>'code'),'Trab',(item->>'planned')::numeric,'Local','ROTINA','Confirmação','000'||prefix||(item->>'code')));
    END LOOP;
    n:=n+1;
    INSERT INTO public.sap_confirmation_rows(import_id,week_id,worksite_id,source_row_number,order_number,confirmation,system_status,actual_work,actual_start_date,actual_end_date,work_center,planning_code)
    VALUES(imp,w.id,w.worksite_id,2147482000+n,'RSCC-TEST',prefix||(item->>'code')||'.0','CONF',(item->>'actual')::numeric,w.start_date,w.start_date+(item->>'days')::int-1,'RSCC_'||coalesce(item->>'center',item->>'code'),'1');
  END LOOP;
  -- Excluded planned HH must not increase eligible credit on the same confirmation.
  FOR day_offset IN 0..1 LOOP
    INSERT INTO public.activities(week_id,worksite_id,source_key,order_number,description,scheduled_date,status,planning_data)
    VALUES(w.id,w.worksite_id,prefix||'MIX'||day_offset,'RSCC-TEST','Teste exclusões',w.start_date,'EXECUTADO',
      jsonb_build_object('CenTrab',CASE WHEN day_offset=0 THEN 'RSCC_MIX' ELSE 'INSPPINT' END,
        'Trab',CASE WHEN day_offset=0 THEN 17.6 ELSE 100 END,'Local','ROTINA','Confirmação',prefix||'MIX'));
  END LOOP;
  INSERT INTO public.sap_confirmation_rows(import_id,week_id,worksite_id,source_row_number,order_number,confirmation,system_status,actual_work,actual_start_date,actual_end_date,work_center,planning_code)
  VALUES(imp,w.id,w.worksite_id,2147482050,'RSCC-TEST',prefix||'MIX','CONF',35.2,w.start_date,w.start_date,'RSCC_MIX','1');
  -- One confirmation in two locals/days: allocate the capped total once, before local filtering.
  FOR day_offset IN 0..1 LOOP
    INSERT INTO public.activities(week_id,worksite_id,source_key,order_number,description,scheduled_date,status,planning_data)
    VALUES(w.id,w.worksite_id,prefix||'SPLIT'||day_offset,'RSCC-TEST','Teste locais',w.start_date+day_offset,'EXECUTADO',
      jsonb_build_object('CenTrab','RSCC_SPLIT','Trab',17.6,'Local',CASE WHEN day_offset=0 THEN 'IARI' ELSE 'ROTINA' END,'Confirmação',prefix||'SPLIT'));
    INSERT INTO public.sap_confirmation_rows(import_id,week_id,worksite_id,source_row_number,order_number,confirmation,system_status,actual_work,actual_start_date,actual_end_date,work_center,planning_code)
    VALUES(imp,w.id,w.worksite_id,2147482100+day_offset,'RSCC-TEST',prefix||'SPLIT','CONF',35.2,w.start_date+day_offset,w.start_date+day_offset,'RSCC_SPLIT','1');
  END LOOP;
  INSERT INTO public.sap_confirmation_rows(import_id,week_id,worksite_id,source_row_number,order_number,confirmation,system_status,actual_work,actual_start_date,actual_end_date,work_center,planning_code)
  VALUES(imp,w.id,w.worksite_id,2147482200,'RSCC-TEST',prefix||'IMMEDIATE','CONF',20,w.start_date,w.start_date,'RSCC_IMMEDIATE','2');
END $setup$;
SET LOCAL ROLE authenticated;
DO $test$
DECLARE a jsonb; i jsonb; r jsonb; c text; expected numeric; actual numeric;
BEGIN
  a:=public.get_weekly_rs_analysis('eea7fc13-1bfd-4117-b315-257fd1db1ea5',NULL);
  FOREACH c IN ARRAY ARRAY['ONE','PART','MULTI','GROUP','SPLIT','MIX'] LOOP
    expected:=CASE c WHEN 'ONE' THEN 17.6 WHEN 'PART' THEN 8.8 WHEN 'MULTI' THEN 52.8 WHEN 'GROUP' THEN 25 WHEN 'MIX' THEN 17.6 ELSE 35.2 END;
    SELECT sum((value->>'completedForRs')::numeric) INTO actual FROM jsonb_array_elements(a->'centers') WHERE value->>'center'='RSCC_'||c;
    IF abs(actual-expected)>0.00000001 OR actual IS NULL THEN RAISE EXCEPTION 'Crédito incorreto %: % versus %',c,actual,expected; END IF;
  END LOOP;
  SELECT sum((value->>'completed')::numeric) INTO actual FROM jsonb_array_elements(a->'centers') WHERE value->>'center'='RSCC_ONE';
  IF actual<>35.2 THEN RAISE EXCEPTION 'SAP bruto alterado'; END IF;
  SELECT sum((value->>'immediate')::numeric) INTO actual FROM jsonb_array_elements(a->'centers') WHERE value->>'center'='RSCC_IMMEDIATE';
  IF actual<>20 THEN RAISE EXCEPTION 'Imediata mudou'; END IF;
  i:=public.get_weekly_rs_analysis('eea7fc13-1bfd-4117-b315-257fd1db1ea5','IARI');
  r:=public.get_weekly_rs_analysis('eea7fc13-1bfd-4117-b315-257fd1db1ea5','ROTINA');
  SELECT sum((value->>'completedForRs')::numeric) INTO actual FROM jsonb_array_elements(i->'centers') WHERE value->>'center'='RSCC_SPLIT';
  IF abs(actual-17.6)>0.00000001 THEN RAISE EXCEPTION 'Teto duplicado no IARI'; END IF;
  SELECT sum((value->>'completedForRs')::numeric) INTO actual FROM jsonb_array_elements(r->'centers') WHERE value->>'center'='RSCC_SPLIT';
  IF abs(actual-17.6)>0.00000001 THEN RAISE EXCEPTION 'Teto duplicado na ROTINA'; END IF;
END $test$;
ROLLBACK;
