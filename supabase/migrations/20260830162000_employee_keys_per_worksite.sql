-- Matrícula e ID podem se repetir em obras diferentes, mas não dentro da mesma obra.
ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS employees_badge_key;
ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS employees_employee_id_key;

DROP INDEX IF EXISTS public.employees_badge_key;
DROP INDEX IF EXISTS public.employees_employee_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS employees_worksite_badge_key
  ON public.employees (worksite_id, badge);

CREATE UNIQUE INDEX IF NOT EXISTS employees_worksite_employee_id_key
  ON public.employees (worksite_id, employee_id);
