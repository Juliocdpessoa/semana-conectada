
-- 1) Add manager role (cannot be used as enum literal in same tx; policies use ::text)
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'manager';

-- 2) Update current_role_label to include manager priority
CREATE OR REPLACE FUNCTION public.current_role_label(_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$ SELECT CASE
  WHEN EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_user_id AND role::text='admin') THEN 'admin'
  WHEN EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_user_id AND role::text='manager') THEN 'manager'
  WHEN EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_user_id AND role::text='planning') THEN 'planning'
  WHEN EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_user_id AND role::text='leader') THEN 'leader'
  WHEN EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_user_id AND role::text='viewer') THEN 'viewer'
  ELSE NULL END $$;

-- 3) Sequential number
CREATE SEQUENCE IF NOT EXISTS public.overtime_request_number_seq START 1;

-- 4) Table
CREATE TABLE public.overtime_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_number BIGINT NOT NULL DEFAULT nextval('public.overtime_request_number_seq') UNIQUE,
  requester_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  requester_name TEXT NOT NULL DEFAULT '',
  requester_email TEXT NOT NULL DEFAULT '',
  employee_name TEXT NOT NULL,
  employee_registration TEXT NOT NULL,
  employee_role TEXT NOT NULL,
  activity_id UUID REFERENCES public.activities(id) ON DELETE SET NULL,
  week_id UUID REFERENCES public.weeks(id) ON DELETE SET NULL,
  order_number TEXT,
  service_description TEXT NOT NULL,
  overtime_date DATE NOT NULL,
  entry_time TEXT,
  departure_time TEXT NOT NULL,
  needs_snack BOOLEAN NOT NULL DEFAULT false,
  justification TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  manager_comment TEXT,
  decided_by_user_id UUID REFERENCES auth.users(id),
  decided_by_name TEXT,
  decided_by_email TEXT,
  decided_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX overtime_requests_status_idx ON public.overtime_requests(status);
CREATE INDEX overtime_requests_requester_idx ON public.overtime_requests(requester_user_id);
CREATE INDEX overtime_requests_date_idx ON public.overtime_requests(overtime_date);
CREATE INDEX overtime_requests_created_idx ON public.overtime_requests(created_at DESC);

-- 5) Grants
GRANT SELECT, INSERT, UPDATE ON public.overtime_requests TO authenticated;
GRANT ALL ON public.overtime_requests TO service_role;
GRANT USAGE ON SEQUENCE public.overtime_request_number_seq TO authenticated, service_role;

-- 6) RLS
ALTER TABLE public.overtime_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ot select"
ON public.overtime_requests FOR SELECT TO authenticated
USING (
  public.is_approved(auth.uid()) AND (
    requester_user_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role::text = 'manager')
  )
);

CREATE POLICY "ot insert own"
ON public.overtime_requests FOR INSERT TO authenticated
WITH CHECK (
  public.is_approved(auth.uid())
  AND requester_user_id = auth.uid()
  AND status = 'pending'
);

CREATE POLICY "ot update"
ON public.overtime_requests FOR UPDATE TO authenticated
USING (
  public.is_approved(auth.uid()) AND (
    requester_user_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role::text = 'manager')
  )
)
WITH CHECK (public.is_approved(auth.uid()));

-- 7) updated_at trigger
CREATE TRIGGER trg_overtime_touch_updated_at
BEFORE UPDATE ON public.overtime_requests
FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
