DO $test$
DECLARE fixture uuid:=gen_random_uuid(); a public.activities%ROWTYPE; original_version int; result jsonb; previous_history int;
BEGIN
 PERFORM set_config('request.jwt.claim.sub','b8b97321-11db-430e-b6b5-40b3cb15f307',true);
 INSERT INTO public.activities SELECT (jsonb_populate_record(NULL::public.activities,to_jsonb(x)||jsonb_build_object('id',fixture,'source_key','patch-regression-'||fixture::text,'pt_number','22.526.522','pt_color','yellow','release_type','PT','version',1))).*
 FROM public.activities x WHERE x.id='b80b6ed1-a7f7-4bb6-830c-34b711da6a3f';
 SELECT * INTO a FROM public.activities WHERE id=fixture;
 original_version:=a.version;
 result:=public.patch_activity_planning_fields(jsonb_build_array(jsonb_build_object('id',fixture,'expected_version',a.version,'fields',jsonb_build_array('pt_number'),'expected_values',jsonb_build_object('pt_number','22.526.522'),'pt_number','22.535.986')));
 IF result->>'count'<>'1' THEN RAISE EXCEPTION 'PT edit failed'; END IF;
 BEGIN
  PERFORM public.patch_activity_planning_fields(jsonb_build_array(jsonb_build_object('id',fixture,'expected_version',original_version,'fields',jsonb_build_array('pt_number'),'expected_values',jsonb_build_object('pt_number','22.526.522'),'pt_number','22.526.522')));
  RAISE EXCEPTION 'Stale version accepted';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
 SELECT * INTO a FROM public.activities WHERE id=fixture;
 BEGIN
  PERFORM public.patch_activity_planning_fields(jsonb_build_array(jsonb_build_object('id',fixture,'expected_version',a.version,'fields',jsonb_build_array('pt_number'),'expected_values',jsonb_build_object('pt_number','22.526.522'),'pt_number','22.526.522')));
  RAISE EXCEPTION 'Stale field baseline accepted';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
 result:=public.patch_activity_planning_fields(jsonb_build_array(jsonb_build_object('id',fixture,'expected_version',a.version,'fields',jsonb_build_array('pt_color'),'expected_values',jsonb_build_object('pt_color',a.pt_color),'pt_color','red')));
 SELECT * INTO a FROM public.activities WHERE id=fixture;
 IF a.pt_number<>'22.535.986' THEN RAISE EXCEPTION 'Colour update overwrote PT'; END IF;
 SELECT count(*) INTO previous_history FROM public.activity_history WHERE activity_id=fixture;
 result:=public.patch_activity_planning_fields(jsonb_build_array(jsonb_build_object('id',fixture,'expected_version',a.version,'fields',jsonb_build_array('pt_number'),'expected_values',jsonb_build_object('pt_number',a.pt_number),'pt_number',a.pt_number)));
 IF result->>'count'<>'0' OR (SELECT version FROM public.activities WHERE id=fixture)<>a.version
 OR (SELECT count(*) FROM public.activity_history WHERE activity_id=fixture)<>previous_history THEN RAISE EXCEPTION 'No-op mutated history'; END IF;
 BEGIN
  PERFORM public.bulk_update_activity_planning_fields(jsonb_build_array(jsonb_build_object('id',fixture,'expected_version',a.version,'pt_number','22.526.522')));
  RAISE EXCEPTION 'Legacy full row accepted';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE 'Atualize a página%' THEN RAISE; END IF;
 END;
 -- Verify the operation profile can edit permitted fields, but cannot edit the date.
 PERFORM set_config('request.jwt.claim.sub',(SELECT changed_by_user_id::text FROM public.activity_history WHERE activity_id='b80b6ed1-a7f7-4bb6-830c-34b711da6a3f' AND change_source='operation' ORDER BY changed_at DESC LIMIT 1),true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',auth.uid(),'session_id',(SELECT id FROM auth.sessions WHERE user_id=auth.uid() ORDER BY created_at DESC LIMIT 1))::text,true);
 SELECT * INTO a FROM public.activities WHERE id=fixture;
 result:=public.patch_activity_planning_fields(jsonb_build_array(jsonb_build_object('id',fixture,'expected_version',a.version,'fields',jsonb_build_array('pt_color'),'expected_values',jsonb_build_object('pt_color',a.pt_color),'pt_color','yellow')));
 SELECT * INTO a FROM public.activities WHERE id=fixture;
 IF a.pt_number<>'22.535.986' THEN RAISE EXCEPTION 'Operation colour edit overwrote PT'; END IF;
 BEGIN
  PERFORM public.patch_activity_planning_fields(jsonb_build_array(jsonb_build_object('id',fixture,'expected_version',a.version,'fields',jsonb_build_array('scheduled_date'),'expected_values',jsonb_build_object('scheduled_date',a.scheduled_date),'scheduled_date','2026-11-20')));
  RAISE EXCEPTION 'Operation edited a protected field';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE 'Operação pode alterar somente%' THEN RAISE; END IF;
 END;
 PERFORM set_config('request.jwt.claim.sub','b8b97321-11db-430e-b6b5-40b3cb15f307',true);
 BEGIN
  PERFORM public.patch_activity_planning_fields(jsonb_build_array(
   jsonb_build_object('id',fixture,'expected_version',a.version,'fields',jsonb_build_array('libra'),'expected_values',jsonb_build_object('libra',a.planning_data->>'LIBRA'),'libra','REGRESSION'),
   jsonb_build_object('id',gen_random_uuid(),'expected_version',1,'fields',jsonb_build_array('pt_number'),'expected_values',jsonb_build_object('pt_number',null),'pt_number','12345678')
  ));
  RAISE EXCEPTION 'Invalid batch accepted';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE 'Atividade inexistente%' THEN RAISE; END IF;
 END;
 IF (SELECT planning_data->>'LIBRA' FROM public.activities WHERE id=fixture) IS DISTINCT FROM a.planning_data->>'LIBRA' THEN RAISE EXCEPTION 'Batch was partially applied'; END IF;
END $test$;
SELECT 'PASS: PT saved, stale version and stale baseline blocked, colour preserves PT, unchanged edit creates no history, legacy tab must refresh' result;