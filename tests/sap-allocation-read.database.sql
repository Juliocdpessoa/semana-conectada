-- Candidate migration must be present. All statements run inside ROLLBACK.
SELECT set_config('nexo.allocation_read_cases',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (
 SELECT DISTINCT ON (ur.role) p.id,p.worksite_id,ur.role::text role FROM public.profiles p
 JOIN public.user_roles ur ON ur.user_id=p.id WHERE p.approval_status='approved'
 ORDER BY ur.role,p.worksite_id,p.id
) x),'[]')::text,true);
SELECT set_config('nexo.allocation_read_cases',(current_setting('nexo.allocation_read_cases')::jsonb||coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (
 SELECT p.id,p.worksite_id,'cross-worksite'::text role FROM public.profiles p WHERE p.approval_status='approved'
 AND p.worksite_id<>'52504243-0000-4000-8000-000000000001' ORDER BY p.id LIMIT 1
) x),'[]'))::text,true);
SET LOCAL ROLE authenticated;
DO $test$ DECLARE c jsonb;old_page jsonb;new_page jsonb;expected jsonb;checked integer:=0;w uuid:='46e561e0-9faf-43ef-a8be-52394d505f61';BEGIN
 FOR c IN SELECT * FROM jsonb_array_elements(current_setting('nexo.allocation_read_cases')::jsonb) LOOP
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',c->>'id','role','authenticated')::text,true);
  new_page:=public.get_activity_sap_allocation_page(w,0,50);
  IF public.can_view_activity_sap(auth.uid()) THEN
   old_page:=public.get_activities_page(w,'{}',0,50);
   SELECT coalesce(jsonb_agg(jsonb_build_object('id',r->'id','order_number',r->'order_number','planning_data',r->'planning_data','scheduled_date',r->'scheduled_date','source_row_number',r->'source_row_number') ORDER BY n),'[]') INTO expected FROM jsonb_array_elements(old_page->'rows') WITH ORDINALITY e(r,n);
   IF expected IS DISTINCT FROM new_page->'rows' OR old_page->'totalAll' IS DISTINCT FROM new_page->'totalAll' THEN RAISE EXCEPTION 'Role projection differs: %',c->>'role';END IF;
  ELSIF new_page->'rows'<>'[]'::jsonb OR (new_page->>'totalAll')::integer<>0 THEN RAISE EXCEPTION 'SAP permission bypass';END IF;
  IF c->>'worksite_id'<>'52504243-0000-4000-8000-000000000001' AND (new_page->>'totalAll')::integer<>0 THEN RAISE EXCEPTION 'Cross-site data exposed';END IF;
  checked:=checked+1;
 END LOOP;
 PERFORM set_config('request.jwt.claims','{}',true);
 new_page:=public.get_activity_sap_allocation_page(w,0,50);
 IF new_page->'rows'<>'[]'::jsonb OR (new_page->>'totalAll')::integer<>0 THEN RAISE EXCEPTION 'Missing identity exposed rows';END IF;
 IF has_function_privilege('anon','public.get_activity_sap_allocation_page(uuid,integer,integer)','EXECUTE') THEN RAISE EXCEPTION 'Anonymous execution exposed';END IF;
 PERFORM set_config('nexo.allocation_cases_checked',checked::text,true);
END $test$;
RESET ROLE;
SELECT current_setting('nexo.allocation_cases_checked')::integer role_contexts_checked,true rows_equal_under_rls,true anonymous_denied;
