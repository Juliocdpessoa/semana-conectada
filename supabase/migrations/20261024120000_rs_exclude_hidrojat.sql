-- Exact SAP code HIDROJAT is monitoring-only, alongside the existing HIDROJATO alias.
-- No source rows or preserved closure snapshots are modified.
CREATE OR REPLACE FUNCTION public.weekly_rs_included(p_center text,p_specialty text)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path=public AS $$
  SELECT upper(regexp_replace(btrim(coalesce(p_center,'')),'\s+',' ','g'))
    NOT IN ('INSPPINT','TECNIEND','TECNINSC','HIDROJAT','HIDROJATO')
    AND upper(btrim(coalesce(p_specialty,''))) NOT IN ('ALPINISTA','ALPINISTAS','ALPINISMO');
$$;
REVOKE ALL ON FUNCTION public.weekly_rs_included(text,text) FROM PUBLIC,anon,authenticated;

DO $migration$
DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef('public.capture_weekly_rs_closure(uuid,text)'::regprocedure) INTO definition;
  IF position($old$jsonb_build_array('INSPPINT','TECNIEND','TECNINSC','HIDROJATO')$old$ IN definition)>0 THEN
    definition:=replace(definition,$old$jsonb_build_array('INSPPINT','TECNIEND','TECNINSC','HIDROJATO')$old$,$new$jsonb_build_array('INSPPINT','TECNIEND','TECNINSC','HIDROJAT','HIDROJATO')$new$);
    definition:=replace(definition,'rs-hh-2026-10-23-v1','rs-hh-2026-10-24-v2');
    EXECUTE definition;
  ELSIF position('rs-hh-2026-10-24-v2' IN definition)=0 THEN
    RAISE EXCEPTION 'Definição de fechamento RS mudou; revisar migração HIDROJAT';
  END IF;
END $migration$;
NOTIFY pgrst,'reload schema';
