-- ============ Transporte Programado ============
CREATE TABLE public.scheduled_transport_batches (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  weekdays SMALLINT[] NOT NULL DEFAULT '{}',
  entry_time TEXT NOT NULL,
  departure_time TEXT NOT NULL,
  needs_snack BOOLEAN NOT NULL DEFAULT false,
  needs_transport BOOLEAN NOT NULL DEFAULT true,
  order_number TEXT,
  service_description TEXT,
  observation TEXT,
  created_by_user_id UUID REFERENCES auth.users(id),
  created_by_name TEXT NOT NULL DEFAULT '',
  created_by_email TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE public.scheduled_transport_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  batch_id UUID REFERENCES public.scheduled_transport_batches(id) ON DELETE SET NULL,
  requester_user_id UUID REFERENCES auth.users(id),
  requester_name TEXT NOT NULL DEFAULT '',
  requester_email TEXT NOT NULL DEFAULT '',
  employee_master_id UUID NOT NULL REFERENCES public.employees(id),
  employee_external_id TEXT,
  employee_registration TEXT,
  employee_name TEXT NOT NULL,
  employee_role TEXT NOT NULL DEFAULT '',
  employee_address TEXT,
  employee_neighborhood TEXT,
  employee_city TEXT,
  employee_phone TEXT,
  employee_message_contact TEXT,
  employee_transport_line TEXT,
  transport_date DATE NOT NULL,
  entry_time TEXT NOT NULL,
  departure_time TEXT NOT NULL,
  needs_snack BOOLEAN NOT NULL DEFAULT false,
  needs_transport BOOLEAN NOT NULL DEFAULT true,
  order_number TEXT,
  service_description TEXT,
  observation TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled',
  cancelled_by_user_id UUID REFERENCES auth.users(id),
  cancelled_by_name TEXT,
  cancelled_at TIMESTAMP WITH TIME ZONE,
  updated_by_user_id UUID REFERENCES auth.users(id),
  updated_by_name TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT scheduled_transport_status_check CHECK (status IN ('scheduled','cancelled'))
);

GRANT SELECT, INSERT, UPDATE ON public.scheduled_transport_batches TO authenticated;
GRANT ALL ON public.scheduled_transport_batches TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.scheduled_transport_requests TO authenticated;
GRANT ALL ON public.scheduled_transport_requests TO service_role;

CREATE INDEX idx_sched_transport_date ON public.scheduled_transport_requests (transport_date);
CREATE INDEX idx_sched_transport_employee ON public.scheduled_transport_requests (employee_master_id);
CREATE INDEX idx_sched_transport_batch ON public.scheduled_transport_requests (batch_id);
CREATE INDEX idx_sched_transport_status ON public.scheduled_transport_requests (status);
CREATE INDEX idx_sched_transport_needs ON public.scheduled_transport_requests (needs_transport);
CREATE UNIQUE INDEX uq_sched_transport_active
  ON public.scheduled_transport_requests (employee_master_id, transport_date, entry_time, departure_time)
  WHERE status = 'scheduled';

-- ---------- Auditoria ----------
CREATE OR REPLACE FUNCTION public.tg_sched_transport_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := now();
    NEW.updated_at := now();
    NEW.version := 1;
    IF auth.uid() IS NOT NULL THEN
      NEW.requester_user_id := auth.uid();
    END IF;
    RETURN NEW;
  END IF;

  NEW.id := OLD.id;
  NEW.batch_id := OLD.batch_id;
  NEW.employee_master_id := OLD.employee_master_id;
  NEW.transport_date := OLD.transport_date;
  NEW.requester_user_id := OLD.requester_user_id;
  NEW.requester_name := OLD.requester_name;
  NEW.requester_email := OLD.requester_email;
  NEW.created_at := OLD.created_at;
  NEW.updated_at := now();
  NEW.version := OLD.version + 1;

  IF auth.uid() IS NOT NULL THEN
    NEW.updated_by_user_id := auth.uid();
    NEW.updated_by_name := COALESCE((SELECT full_name FROM public.profiles WHERE id = auth.uid()), '');
  END IF;

  IF OLD.status <> 'cancelled' AND NEW.status = 'cancelled' THEN
    NEW.cancelled_at := now();
    IF auth.uid() IS NOT NULL THEN
      NEW.cancelled_by_user_id := auth.uid();
      NEW.cancelled_by_name := COALESCE((SELECT full_name FROM public.profiles WHERE id = auth.uid()), '');
    END IF;
  ELSIF NEW.status <> 'cancelled' THEN
    NEW.cancelled_at := NULL;
    NEW.cancelled_by_user_id := NULL;
    NEW.cancelled_by_name := NULL;
  ELSE
    NEW.cancelled_at := OLD.cancelled_at;
    NEW.cancelled_by_user_id := OLD.cancelled_by_user_id;
    NEW.cancelled_by_name := OLD.cancelled_by_name;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sched_transport_audit
BEFORE INSERT OR UPDATE ON public.scheduled_transport_requests
FOR EACH ROW EXECUTE FUNCTION public.tg_sched_transport_audit();

CREATE TRIGGER trg_sched_transport_batches_touch
BEFORE UPDATE ON public.scheduled_transport_batches
FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- ---------- Permissões ----------
CREATE OR REPLACE FUNCTION public.can_manage_scheduled_transport(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_approved(_user_id) AND EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND role::text = ANY (ARRAY['admin','manager','logistics','planning'])
  )
$$;

ALTER TABLE public.scheduled_transport_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduled_transport_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sched transport batches select" ON public.scheduled_transport_batches
  FOR SELECT TO authenticated USING (public.can_manage_scheduled_transport(auth.uid()));
CREATE POLICY "sched transport batches insert" ON public.scheduled_transport_batches
  FOR INSERT TO authenticated WITH CHECK (public.can_manage_scheduled_transport(auth.uid()));
CREATE POLICY "sched transport batches update" ON public.scheduled_transport_batches
  FOR UPDATE TO authenticated USING (public.can_manage_scheduled_transport(auth.uid()))
  WITH CHECK (public.can_manage_scheduled_transport(auth.uid()));

CREATE POLICY "sched transport select" ON public.scheduled_transport_requests
  FOR SELECT TO authenticated USING (public.can_manage_scheduled_transport(auth.uid()));
CREATE POLICY "sched transport insert" ON public.scheduled_transport_requests
  FOR INSERT TO authenticated WITH CHECK (public.can_manage_scheduled_transport(auth.uid()));
CREATE POLICY "sched transport update" ON public.scheduled_transport_requests
  FOR UPDATE TO authenticated USING (public.can_manage_scheduled_transport(auth.uid()))
  WITH CHECK (public.can_manage_scheduled_transport(auth.uid()));

-- Mudanças de escala são gravadas somente pelas funções autenticadas do servidor.
-- As funções usam service_role após validar aprovação e papel do usuário.
REVOKE ALL PRIVILEGES ON public.scheduled_transport_batches FROM authenticated;
REVOKE ALL PRIVILEGES ON public.scheduled_transport_requests FROM authenticated;

DROP POLICY IF EXISTS "sched transport batches insert" ON public.scheduled_transport_batches;
DROP POLICY IF EXISTS "sched transport batches update" ON public.scheduled_transport_batches;
DROP POLICY IF EXISTS "sched transport insert" ON public.scheduled_transport_requests;
DROP POLICY IF EXISTS "sched transport update" ON public.scheduled_transport_requests;

-- A leitura direta permanece limitada pela política RLS can_manage_scheduled_transport.
GRANT SELECT ON public.scheduled_transport_batches TO authenticated;
GRANT SELECT ON public.scheduled_transport_requests TO authenticated;
