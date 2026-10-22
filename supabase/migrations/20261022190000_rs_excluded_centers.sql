-- Exact work-center exclusions, shared by task evidence and unresolved-local validation.
-- Source availability/SAP/tasks are retained. Daily operational capacity is unchanged.
CREATE OR REPLACE FUNCTION public.weekly_rs_included(p_center text,p_specialty text)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path=public AS $$
  SELECT upper(regexp_replace(btrim(coalesce(p_center,'')),'\s+',' ','g'))
    NOT IN ('INSPPINT','TECNIEND','TECNINSC','HIDROJATO')
    AND upper(btrim(coalesce(p_specialty,''))) NOT IN ('ALPINISTA','ALPINISTAS','ALPINISMO');
$$;
REVOKE ALL ON FUNCTION public.weekly_rs_included(text,text) FROM PUBLIC,anon,authenticated;

DO $migration$
DECLARE definition text; old_predicate text:=$old$upper(btrim(coalesce(m.specialty,''))) NOT IN ('ALPINISTA','ALPINISTAS','ALPINISMO')$old$;
BEGIN
  SELECT pg_get_functiondef('public.weekly_rs_activity_evidence(uuid)'::regprocedure) INTO definition;
  IF position(old_predicate IN definition)>0 THEN
    EXECUTE replace(definition,old_predicate,'public.weekly_rs_included(p.center_key,m.specialty)');
  ELSIF position('public.weekly_rs_included(p.center_key,m.specialty)' IN definition)=0 THEN
    RAISE EXCEPTION 'Definição de evidência RS mudou; revisar migração';
  END IF;
  SELECT pg_get_functiondef('public.get_weekly_rs_analysis(uuid,text)'::regprocedure) INTO definition;
  IF position(old_predicate IN definition)>0 THEN
    EXECUTE replace(definition,old_predicate,'public.weekly_rs_included(c.center,m.specialty)');
  ELSIF position('public.weekly_rs_included(c.center,m.specialty)' IN definition)=0 THEN
    RAISE EXCEPTION 'Definição da análise RS mudou; revisar migração';
  END IF;
END $migration$;
NOTIFY pgrst,'reload schema';
