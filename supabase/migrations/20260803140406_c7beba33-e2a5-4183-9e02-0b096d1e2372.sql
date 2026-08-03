ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'logistics';
ALTER TABLE public.overtime_requests ADD COLUMN IF NOT EXISTS needs_transport boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_overtime_requests_needs_transport ON public.overtime_requests (needs_transport);