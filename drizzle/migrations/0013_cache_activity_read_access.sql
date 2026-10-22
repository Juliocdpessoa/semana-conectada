-- Preserve existing SELECT permissions. Evaluate user-only checks once per
-- statement instead of repeatedly for every activity. Do not bypass RLS.
DO $migration$
DECLARE policy_name text; original text; optimized text; role_name text;
BEGIN
  FOREACH policy_name IN ARRAY ARRAY['activities select within worksite','activities read operation and viewer'] LOOP
    SELECT qual INTO original FROM pg_policies
      WHERE schemaname='public' AND tablename='activities' AND policyname=policy_name AND cmd='SELECT';
    IF original IS NULL THEN RAISE EXCEPTION 'Política esperada não encontrada: %',policy_name; END IF;
    IF position('current_worksite_id' IN original)>0 THEN CONTINUE; END IF;
    IF position('can_access_worksite(auth.uid(), worksite_id)' IN original)=0 THEN
      RAISE EXCEPTION 'Política incompatível: %; nenhuma alteração deve ser aplicada',policy_name;
    END IF;
    optimized := replace(original,'can_access_worksite(auth.uid(), worksite_id)',
      '(worksite_id = (SELECT public.current_worksite_id(auth.uid()))
        AND (SELECT public.can_access_worksite(auth.uid(), public.current_worksite_id(auth.uid()))))');
    FOREACH role_name IN ARRAY ARRAY['planning','admin','operation'] LOOP
      optimized := replace(optimized,
        format('has_role(auth.uid(), %L::app_role)',role_name),
        format('(SELECT public.has_role(auth.uid(), %L::public.app_role))',role_name));
    END LOOP;
    EXECUTE format('ALTER POLICY %I ON public.activities USING (%s)',policy_name,optimized);
  END LOOP;
END
$migration$;
