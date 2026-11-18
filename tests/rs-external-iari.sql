DO $tests$
DECLARE failures integer;
BEGIN
 SELECT count(*) INTO failures FROM (VALUES
 ('52504243-0000-4000-8000-000000000001'::uuid,'IARI','1',true),
 ('52504243-0000-4000-8000-000000000001'::uuid,'IARI','01.0',true),
 ('52504243-0000-4000-8000-000000000001'::uuid,'ROTINA','1',false),
 ('52504243-0000-4000-8000-000000000001'::uuid,'SEM LOCAL','1',false),
 ('68166d78-53b7-4c66-bea9-deb94e39a2c3'::uuid,'IARI','1',false),
 ('52504243-0000-4000-8000-000000000001'::uuid,'ROTINA','2',true),
 ('68166d78-53b7-4c66-bea9-deb94e39a2c3'::uuid,'IARI','2',true),
 ('52504243-0000-4000-8000-000000000001'::uuid,'IARI','3',false)
 ) t(site,local,code,expected) WHERE coalesce(public.rs_external_sap_counts(site,local,code),false) IS DISTINCT FROM expected;
 IF failures<>0 THEN RAISE EXCEPTION 'RS external rule tests failed: %',failures; END IF;
END $tests$;