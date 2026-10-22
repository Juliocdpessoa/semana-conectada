-- Run after configuring request.jwt.claim.sub for the test user.
-- Compare the cached worksite predicate to the original for every worksite.
-- Evaluate under the database owner so denied worksites remain in the test.
BEGIN;
DO $test$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Configure um usuário para o teste'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.worksites w WHERE
      public.can_access_worksite(auth.uid(),w.id) IS DISTINCT FROM
      (w.id=public.current_worksite_id(auth.uid()) AND
       public.can_access_worksite(auth.uid(),public.current_worksite_id(auth.uid())))
  ) THEN RAISE EXCEPTION 'Predicado de acesso não equivalente'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='activities'
      AND policyname IN ('activities select within worksite','activities read operation and viewer')
      AND position('current_worksite_id' IN qual)=0
  ) THEN RAISE EXCEPTION 'Migração de leitura não aplicada'; END IF;
END $test$;
ROLLBACK;
