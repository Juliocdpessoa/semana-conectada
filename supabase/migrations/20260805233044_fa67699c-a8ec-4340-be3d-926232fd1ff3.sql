DROP POLICY IF EXISTS "employees select approved overtime users" ON public.employees;
CREATE POLICY "employees select approved overtime users" ON public.employees
FOR SELECT TO authenticated
USING (
  is_approved(auth.uid()) AND (
    has_role(auth.uid(), 'admin'::app_role) OR EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role::text = ANY (ARRAY['manager','leader','measurement_control','logistics'])
    )
  )
);