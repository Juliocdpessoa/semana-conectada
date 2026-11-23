-- Preserve the existing authorization predicates; evaluate caller/worksite
-- membership once per SELECT rather than once for every returned SAP/employee row.
CREATE OR REPLACE FUNCTION public.nexo_read_worksite_scope()
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=public,pg_temp AS $$
 SELECT coalesce(array_agg(w.id),'{}'::uuid[]) FROM public.worksites w
 WHERE auth.uid() IS NOT NULL AND public.can_access_worksite(auth.uid(),w.id)
$$;
REVOKE ALL ON FUNCTION public.nexo_read_worksite_scope() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.nexo_read_worksite_scope() TO authenticated;

ALTER POLICY "operation_activity_sap_rows_read" ON public.sap_confirmation_rows
 USING ((SELECT public.can_view_activity_sap(auth.uid()))
 AND worksite_id IN (SELECT unnest(public.nexo_read_worksite_scope())));
ALTER POLICY "sap rows visible to planning within active worksite" ON public.sap_confirmation_rows
 USING ((SELECT public.can_access_sap(auth.uid()))
 AND worksite_id IN (SELECT unnest(public.nexo_read_worksite_scope())));
ALTER POLICY "employees select within worksite" ON public.employees
 USING (worksite_id IN (SELECT unnest(public.nexo_read_worksite_scope())) AND EXISTS(
  SELECT 1 FROM public.user_roles ur WHERE ur.user_id=auth.uid()
  AND ur.role::text=ANY(ARRAY['admin','manager','leader','measurement_control','logistics']::text[])));
-- Restrictive password gates, table grants, writes, and business functions are unchanged.
