-- Classification-only correction. No activity, SAP, availability or frozen record is rewritten.
CREATE OR REPLACE FUNCTION public.rs_center_local(p_center text,p_fallback text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path=public AS $function$
 SELECT CASE WHEN public.rs_program_center(p_center)='SERVIARI' THEN 'IARI'
 ELSE coalesce(nullif(upper(btrim(p_fallback)),''),'SEM LOCAL') END;
$function$;
REVOKE ALL ON FUNCTION public.rs_center_local(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rs_center_local(text,text) TO authenticated;

-- Preserve complete current implementations, access checks, caps and fallback routing.
DO $migration$
DECLARE patch record; definition text;
BEGIN
 FOR patch IN SELECT * FROM (VALUES
  ('public.weekly_rs_activity_evidence(uuid)',$old$coalesce(nullif(upper(btrim(p.planning_data->>'Local')),''),m.local,'SEM LOCAL')$old$,$new$public.rs_center_local(p.center_key,coalesce(nullif(upper(btrim(p.planning_data->>'Local')),''),m.local,'SEM LOCAL'))$new$),
  ('public.get_weekly_rs_analysis(uuid,text)',$old$coalesce(CASE WHEN matches.local_count=1 THEN matches.local END,m.local,'SEM LOCAL') local$old$,$new$public.rs_center_local(s.work_center,coalesce(CASE WHEN matches.local_count=1 THEN matches.local END,m.local,'SEM LOCAL')) local$new$),
  ('public.get_weekly_rs_official_analysis(uuid,text)',$old$coalesce(m.local,o.local,'SEM LOCAL') local$old$,$new$public.rs_center_local(r->>'center',coalesce(m.local,o.local,'SEM LOCAL')) local$new$),
  ('public.get_weekly_rs_official_analysis(uuid,text)',$old$coalesce(p.local,m.local,'SEM LOCAL') local$old$,$new$public.rs_center_local(s.center,coalesce(p.local,m.local,'SEM LOCAL')) local$new$),
  ('public.save_weekly_rs_availability(uuid,jsonb,integer,text)',$old$    dt:=(item->>'date')::date;$old$,$new$    IF public.rs_program_center(item->>'center')='SERVIARI' AND upper(btrim(item->>'local'))<>'IARI' THEN
      RAISE EXCEPTION 'O centro SERVIARI pertence sempre a IARI.';
    END IF;
    dt:=(item->>'date')::date;$new$),
  ('public.capture_weekly_rs_closure(uuid,text)',$old$'rs-hh-2026-10-24-v3'$old$,$new$'rs-hh-2026-10-27-v4'$new$),
  ('public.capture_weekly_rs_closure(uuid,text)',$old$jsonb_build_object('source','Última carga SAP detalhada da semana'$old$,$new$jsonb_build_object('centerLocalRule','SERVIARI sempre IARI; demais vínculos preservados','source','Última carga SAP detalhada da semana'$new$)
 ) AS patches(signature,old_text,new_text) LOOP
  SELECT pg_get_functiondef(patch.signature::regprocedure) INTO definition;
  IF position(patch.new_text IN definition)>0 THEN CONTINUE; END IF;
  IF position(patch.old_text IN definition)=0 THEN
   RAISE EXCEPTION 'Implementação RS mudou; revisar correção SERVIARI em %',patch.signature;
  END IF;
  EXECUTE replace(definition,patch.old_text,patch.new_text);
 END LOOP;
END $migration$;
NOTIFY pgrst,'reload schema';
