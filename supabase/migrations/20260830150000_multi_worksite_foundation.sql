-- Multiobra, fase 1: catálogo de obras e associação de todos os dados atuais à RPBC.
-- Esta fase é deliberadamente compatível com o aplicativo atual: nenhuma segunda
-- obra pode ser criada pela interface antes da fase de isolamento por RLS.

CREATE TABLE IF NOT EXISTS public.worksites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT worksites_code_format CHECK (code = upper(code) AND code ~ '^[A-Z0-9_-]{2,20}$')
);

INSERT INTO public.worksites (id, code, name)
VALUES (
  '52504243-0000-4000-8000-000000000001',
  'RPBC',
  'Refinaria Presidente Bernardes Cubatão'
)
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, is_active = true;

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS worksite_id uuid REFERENCES public.worksites(id);
ALTER TABLE public.weeks ADD COLUMN IF NOT EXISTS worksite_id uuid REFERENCES public.worksites(id);
ALTER TABLE public.activities ADD COLUMN IF NOT EXISTS worksite_id uuid REFERENCES public.worksites(id);
ALTER TABLE public.activity_history ADD COLUMN IF NOT EXISTS worksite_id uuid REFERENCES public.worksites(id);
ALTER TABLE public.sync_jobs ADD COLUMN IF NOT EXISTS worksite_id uuid REFERENCES public.worksites(id);
ALTER TABLE public.sharepoint_config ADD COLUMN IF NOT EXISTS worksite_id uuid REFERENCES public.worksites(id);
ALTER TABLE public.overtime_requests ADD COLUMN IF NOT EXISTS worksite_id uuid REFERENCES public.worksites(id);
ALTER TABLE public.scheduled_transport_batches ADD COLUMN IF NOT EXISTS worksite_id uuid REFERENCES public.worksites(id);
ALTER TABLE public.scheduled_transport_requests ADD COLUMN IF NOT EXISTS worksite_id uuid REFERENCES public.worksites(id);
ALTER TABLE public.activity_edit_settings ADD COLUMN IF NOT EXISTS worksite_id uuid REFERENCES public.worksites(id);

DO $optional_tables$
BEGIN
  IF to_regclass('public.employees') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS worksite_id uuid REFERENCES public.worksites(id)';
  END IF;
  IF to_regclass('public.employee_days_off') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.employee_days_off ADD COLUMN IF NOT EXISTS worksite_id uuid REFERENCES public.worksites(id)';
  END IF;
END
$optional_tables$;

UPDATE public.profiles SET worksite_id = '52504243-0000-4000-8000-000000000001' WHERE worksite_id IS NULL;
UPDATE public.weeks SET worksite_id = '52504243-0000-4000-8000-000000000001' WHERE worksite_id IS NULL;
UPDATE public.activities a
SET worksite_id = coalesce(w.worksite_id, '52504243-0000-4000-8000-000000000001')
FROM public.weeks w WHERE w.id = a.week_id AND a.worksite_id IS NULL;
UPDATE public.activity_history h
SET worksite_id = coalesce(w.worksite_id, '52504243-0000-4000-8000-000000000001')
FROM public.weeks w WHERE w.id = h.week_id AND h.worksite_id IS NULL;
UPDATE public.sync_jobs j
SET worksite_id = coalesce(a.worksite_id, '52504243-0000-4000-8000-000000000001')
FROM public.activities a WHERE a.id = j.activity_id AND j.worksite_id IS NULL;
UPDATE public.sharepoint_config SET worksite_id = '52504243-0000-4000-8000-000000000001' WHERE worksite_id IS NULL;
UPDATE public.overtime_requests SET worksite_id = '52504243-0000-4000-8000-000000000001' WHERE worksite_id IS NULL;
UPDATE public.scheduled_transport_batches SET worksite_id = '52504243-0000-4000-8000-000000000001' WHERE worksite_id IS NULL;
UPDATE public.scheduled_transport_requests SET worksite_id = '52504243-0000-4000-8000-000000000001' WHERE worksite_id IS NULL;
UPDATE public.activity_edit_settings SET worksite_id = '52504243-0000-4000-8000-000000000001' WHERE worksite_id IS NULL;

DO $optional_backfill$
BEGIN
  IF to_regclass('public.employees') IS NOT NULL THEN
    EXECUTE $$UPDATE public.employees SET worksite_id = '52504243-0000-4000-8000-000000000001' WHERE worksite_id IS NULL$$;
  END IF;
  IF to_regclass('public.employee_days_off') IS NOT NULL THEN
    EXECUTE $$UPDATE public.employee_days_off SET worksite_id = '52504243-0000-4000-8000-000000000001' WHERE worksite_id IS NULL$$;
  END IF;
END
$optional_backfill$;

ALTER TABLE public.profiles ALTER COLUMN worksite_id SET NOT NULL;
ALTER TABLE public.weeks ALTER COLUMN worksite_id SET NOT NULL;
ALTER TABLE public.activities ALTER COLUMN worksite_id SET NOT NULL;
ALTER TABLE public.activity_history ALTER COLUMN worksite_id SET NOT NULL;
ALTER TABLE public.overtime_requests ALTER COLUMN worksite_id SET NOT NULL;
ALTER TABLE public.scheduled_transport_batches ALTER COLUMN worksite_id SET NOT NULL;
ALTER TABLE public.scheduled_transport_requests ALTER COLUMN worksite_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS profiles_worksite_idx ON public.profiles(worksite_id);
CREATE INDEX IF NOT EXISTS weeks_worksite_idx ON public.weeks(worksite_id);
CREATE INDEX IF NOT EXISTS activities_worksite_week_idx ON public.activities(worksite_id, week_id);
CREATE INDEX IF NOT EXISTS activity_history_worksite_idx ON public.activity_history(worksite_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS overtime_worksite_date_idx ON public.overtime_requests(worksite_id, overtime_date DESC);
CREATE INDEX IF NOT EXISTS scheduled_transport_worksite_date_idx
  ON public.scheduled_transport_requests(worksite_id, transport_date DESC);

GRANT SELECT ON public.worksites TO anon, authenticated;
GRANT ALL ON public.worksites TO service_role;
ALTER TABLE public.worksites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "active worksites are visible for registration"
  ON public.worksites FOR SELECT TO anon, authenticated
  USING (is_active = true);

CREATE OR REPLACE FUNCTION public.tg_touch_worksite_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS worksites_touch ON public.worksites;
CREATE TRIGGER worksites_touch BEFORE UPDATE ON public.worksites
FOR EACH ROW EXECUTE FUNCTION public.tg_touch_worksite_updated_at();
