-- Multiobra, fase 2: isolamento obrigatório por obra.
CREATE OR REPLACE FUNCTION public.is_global_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = _user_id
      AND lower(p.email) = 'julio.pessoa@normatel.com.br'
      AND p.approval_status = 'approved'
  )
$$;

CREATE OR REPLACE FUNCTION public.current_worksite_id(_user_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.worksite_id FROM public.profiles p WHERE p.id = _user_id
$$;

CREATE OR REPLACE FUNCTION public.can_access_worksite(_user_id uuid, _worksite_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_approved(_user_id) AND (
    public.is_global_admin(_user_id)
    OR public.current_worksite_id(_user_id) = _worksite_id
  )
$$;

CREATE OR REPLACE FUNCTION public.can_admin_worksite(_user_id uuid, _worksite_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_approved(_user_id) AND (
    public.is_global_admin(_user_id)
    OR (
      public.current_worksite_id(_user_id) = _worksite_id
      AND public.has_role(_user_id, 'admin')
    )
  )
$$;

GRANT EXECUTE ON FUNCTION public.is_global_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_worksite_id(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_worksite(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_admin_worksite(uuid,uuid) TO authenticated;

DROP POLICY IF EXISTS "profiles select self" ON public.profiles;
DROP POLICY IF EXISTS "profiles update admin" ON public.profiles;
DROP POLICY IF EXISTS "profiles update own name" ON public.profiles;
DROP POLICY IF EXISTS "profiles insert self" ON public.profiles;
CREATE POLICY "profiles select within worksite" ON public.profiles FOR SELECT TO authenticated
USING (
  id = auth.uid()
  OR public.is_global_admin(auth.uid())
  OR public.can_admin_worksite(auth.uid(), worksite_id)
);
CREATE POLICY "profiles update within worksite" ON public.profiles FOR UPDATE TO authenticated
USING (public.can_admin_worksite(auth.uid(), worksite_id))
WITH CHECK (public.can_admin_worksite(auth.uid(), worksite_id));

DROP POLICY IF EXISTS "user_roles select self or admin" ON public.user_roles;
CREATE POLICY "user roles within worksite" ON public.user_roles FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR public.is_global_admin(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.profiles target
    WHERE target.id = user_roles.user_id
      AND public.can_admin_worksite(auth.uid(), target.worksite_id)
  )
);

DROP POLICY IF EXISTS "weeks select approved" ON public.weeks;
DROP POLICY IF EXISTS "weeks select by lifecycle" ON public.weeks;
DROP POLICY IF EXISTS "weeks write planning" ON public.weeks;
CREATE POLICY "weeks select within worksite" ON public.weeks FOR SELECT TO authenticated
USING (
  public.can_access_worksite(auth.uid(), worksite_id)
  AND (lifecycle_status <> 'preparation' OR public.has_role(auth.uid(),'planning') OR public.has_role(auth.uid(),'admin'))
);
CREATE POLICY "weeks write within worksite" ON public.weeks FOR ALL TO authenticated
USING (
  public.can_access_worksite(auth.uid(), worksite_id)
  AND (public.has_role(auth.uid(),'planning') OR public.has_role(auth.uid(),'admin'))
)
WITH CHECK (
  public.can_access_worksite(auth.uid(), worksite_id)
  AND (public.has_role(auth.uid(),'planning') OR public.has_role(auth.uid(),'admin'))
);

DROP POLICY IF EXISTS "activities select approved" ON public.activities;
DROP POLICY IF EXISTS "activities select by week lifecycle" ON public.activities;
DROP POLICY IF EXISTS "activities update leader" ON public.activities;
DROP POLICY IF EXISTS "activities insert planning" ON public.activities;
DROP POLICY IF EXISTS "activities delete planning" ON public.activities;
CREATE POLICY "activities select within worksite" ON public.activities FOR SELECT TO authenticated
USING (
  public.can_access_worksite(auth.uid(), worksite_id)
  AND EXISTS (
    SELECT 1 FROM public.weeks w WHERE w.id = activities.week_id
      AND (w.lifecycle_status <> 'preparation' OR public.has_role(auth.uid(),'planning') OR public.has_role(auth.uid(),'admin'))
  )
);
CREATE POLICY "activities update within worksite" ON public.activities FOR UPDATE TO authenticated
USING (
  public.can_access_worksite(auth.uid(), worksite_id)
  AND (public.has_role(auth.uid(),'leader') OR public.has_role(auth.uid(),'planning') OR public.has_role(auth.uid(),'admin'))
)
WITH CHECK (public.can_access_worksite(auth.uid(), worksite_id));
CREATE POLICY "activities insert within worksite" ON public.activities FOR INSERT TO authenticated
WITH CHECK (
  public.can_access_worksite(auth.uid(), worksite_id)
  AND (public.has_role(auth.uid(),'planning') OR public.has_role(auth.uid(),'admin'))
);
CREATE POLICY "activities delete within worksite" ON public.activities FOR DELETE TO authenticated
USING (
  public.can_access_worksite(auth.uid(), worksite_id)
  AND (public.has_role(auth.uid(),'planning') OR public.has_role(auth.uid(),'admin'))
);

DROP POLICY IF EXISTS "history select planning" ON public.activity_history;
DROP POLICY IF EXISTS "history select approved" ON public.activity_history;
DROP POLICY IF EXISTS "history select by week lifecycle" ON public.activity_history;
CREATE POLICY "history select within worksite" ON public.activity_history FOR SELECT TO authenticated
USING (public.can_access_worksite(auth.uid(), worksite_id));

DROP POLICY IF EXISTS "ot select" ON public.overtime_requests;
DROP POLICY IF EXISTS "ot insert own" ON public.overtime_requests;
DROP POLICY IF EXISTS "ot update" ON public.overtime_requests;
CREATE POLICY "overtime select within worksite" ON public.overtime_requests FOR SELECT TO authenticated
USING (
  public.can_access_worksite(auth.uid(), worksite_id)
  AND (
    requester_user_id = auth.uid()
    OR public.has_role(auth.uid(),'admin')
    OR public.has_role(auth.uid(),'manager')
    OR (status = 'approved' AND public.has_role(auth.uid(),'measurement_control'))
    OR public.has_role(auth.uid(),'logistics')
  )
);
CREATE POLICY "overtime insert within worksite" ON public.overtime_requests FOR INSERT TO authenticated
WITH CHECK (
  public.can_access_worksite(auth.uid(), worksite_id)
  AND requester_user_id = auth.uid()
  AND status = 'pending'
);
CREATE POLICY "overtime update within worksite" ON public.overtime_requests FOR UPDATE TO authenticated
USING (
  public.can_access_worksite(auth.uid(), worksite_id)
  AND (requester_user_id = auth.uid() OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager'))
)
WITH CHECK (public.can_access_worksite(auth.uid(), worksite_id));

DROP POLICY IF EXISTS "employees select approved overtime users" ON public.employees;
CREATE POLICY "employees select within worksite" ON public.employees FOR SELECT TO authenticated
USING (
  public.can_access_worksite(auth.uid(), worksite_id)
  AND EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role::text IN ('admin','manager','leader','measurement_control','logistics')
  )
);

DROP POLICY IF EXISTS "sched transport batches select" ON public.scheduled_transport_batches;
DROP POLICY IF EXISTS "sched transport select" ON public.scheduled_transport_requests;
CREATE POLICY "scheduled batches select within worksite" ON public.scheduled_transport_batches FOR SELECT TO authenticated
USING (public.can_access_worksite(auth.uid(), worksite_id) AND public.can_manage_scheduled_transport(auth.uid()));
CREATE POLICY "scheduled requests select within worksite" ON public.scheduled_transport_requests FOR SELECT TO authenticated
USING (public.can_access_worksite(auth.uid(), worksite_id) AND public.can_manage_scheduled_transport(auth.uid()));

DROP POLICY IF EXISTS "sync select planning" ON public.sync_jobs;
CREATE POLICY "sync select within worksite" ON public.sync_jobs FOR SELECT TO authenticated
USING (
  public.can_access_worksite(auth.uid(), worksite_id)
  AND (public.has_role(auth.uid(),'planning') OR public.has_role(auth.uid(),'admin'))
);

DROP POLICY IF EXISTS "sp select approved" ON public.sharepoint_config;
DROP POLICY IF EXISTS "sp update admin" ON public.sharepoint_config;
CREATE POLICY "sharepoint select within worksite" ON public.sharepoint_config FOR SELECT TO authenticated
USING (public.can_access_worksite(auth.uid(), worksite_id));
CREATE POLICY "sharepoint update within worksite" ON public.sharepoint_config FOR UPDATE TO authenticated
USING (public.can_admin_worksite(auth.uid(), worksite_id))
WITH CHECK (public.can_admin_worksite(auth.uid(), worksite_id));

DROP POLICY IF EXISTS "Authenticated users can read activity edit settings" ON public.activity_edit_settings;
CREATE POLICY "activity settings select within worksite" ON public.activity_edit_settings FOR SELECT TO authenticated
USING (public.can_access_worksite(auth.uid(), worksite_id));

DO $do$
BEGIN
  IF to_regclass('public.employee_days_off') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.employee_days_off ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "employee days off within worksite" ON public.employee_days_off';
    EXECUTE $policy$CREATE POLICY "employee days off within worksite"
      ON public.employee_days_off FOR SELECT TO authenticated
      USING (public.can_access_worksite(auth.uid(), worksite_id))$policy$;
  END IF;
END
$do$;

DROP POLICY IF EXISTS "active worksites are visible for registration" ON public.worksites;
CREATE POLICY "active worksites are visible for registration" ON public.worksites FOR SELECT TO anon, authenticated
USING (is_active = true OR public.is_global_admin(auth.uid()));

CREATE INDEX IF NOT EXISTS employees_worksite_name_idx ON public.employees(worksite_id, full_name);
CREATE INDEX IF NOT EXISTS scheduled_batches_worksite_idx ON public.scheduled_transport_batches(worksite_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sync_jobs_worksite_idx ON public.sync_jobs(worksite_id, created_at DESC);
