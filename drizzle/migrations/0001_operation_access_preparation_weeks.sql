DROP POLICY IF EXISTS "weeks select within worksite" ON public.weeks;
CREATE POLICY "weeks select within worksite" ON public.weeks
FOR SELECT USING (
  can_access_worksite(auth.uid(), worksite_id)
  AND (
    lifecycle_status <> 'preparation'
    OR has_role(auth.uid(), 'planning'::app_role)
    OR has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'operation'::app_role)
  )
);

DROP POLICY IF EXISTS "activities select within worksite" ON public.activities;
CREATE POLICY "activities select within worksite" ON public.activities
FOR SELECT USING (
  can_access_worksite(auth.uid(), worksite_id)
  AND EXISTS (
    SELECT 1 FROM public.weeks w
    WHERE w.id = activities.week_id
      AND (
        w.lifecycle_status <> 'preparation'
        OR has_role(auth.uid(), 'planning'::app_role)
        OR has_role(auth.uid(), 'admin'::app_role)
        OR has_role(auth.uid(), 'operation'::app_role)
      )
  )
);

DROP POLICY IF EXISTS "activities read operation and viewer" ON public.activities;
CREATE POLICY "activities read operation and viewer" ON public.activities
FOR SELECT USING (
  can_access_worksite(auth.uid(), worksite_id)
  AND EXISTS (
    SELECT 1 FROM public.weeks w
    WHERE w.id = activities.week_id
      AND w.worksite_id = activities.worksite_id
      AND (
        w.lifecycle_status <> 'preparation'
        OR has_role(auth.uid(), 'operation'::app_role)
      )
  )
  AND EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role::text = ANY (ARRAY['operation','viewer'])
  )
);