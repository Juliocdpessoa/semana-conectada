DROP POLICY IF EXISTS "activities update within worksite" ON public.activities;
CREATE POLICY "activities update within worksite"
ON public.activities
FOR UPDATE
USING (
  can_access_worksite(auth.uid(), worksite_id)
  AND (
    has_role(auth.uid(), 'leader'::app_role)
    OR has_role(auth.uid(), 'planning'::app_role)
    OR has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'manager'::app_role)
    OR has_role(auth.uid(), 'operation'::app_role)
  )
)
WITH CHECK (can_access_worksite(auth.uid(), worksite_id));