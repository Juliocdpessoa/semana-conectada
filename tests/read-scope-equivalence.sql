-- Read-only authorization comparison; no users, tasks or roles are created.
-- Run after the migration (or inside a rolled-back migration rehearsal).
BEGIN;
SET LOCAL statement_timeout='15s';
DO $test$
DECLARE p record;w record;scope uuid[];
BEGIN
 FOR p IN SELECT id FROM public.profiles LOOP
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',p.id,'role','authenticated','iat',floor(extract(epoch from now())))::text,true);
  scope:=public.nexo_read_worksite_scope();
  FOR w IN SELECT id FROM public.worksites LOOP
   IF coalesce(public.can_access_worksite(p.id,w.id),false) IS DISTINCT FROM (w.id=ANY(scope)) THEN
    RAISE EXCEPTION 'Worksite authorization changed';
   END IF;
  END LOOP;
 END LOOP;
 PERFORM set_config('request.jwt.claims','{}',true);
 IF cardinality(public.nexo_read_worksite_scope())<>0 THEN RAISE EXCEPTION 'Anonymous scope granted';END IF;
 IF has_function_privilege('anon','public.nexo_read_worksite_scope()','EXECUTE') THEN RAISE EXCEPTION 'Anonymous execute granted';END IF;
END $test$;
ROLLBACK;
