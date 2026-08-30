-- Compatibilidade durante a implantação gradual: até todos os fluxos enviarem
-- explicitamente a obra, novos registros permanecem associados à RPBC.
ALTER TABLE public.profiles ALTER COLUMN worksite_id SET DEFAULT '52504243-0000-4000-8000-000000000001';
ALTER TABLE public.weeks ALTER COLUMN worksite_id SET DEFAULT '52504243-0000-4000-8000-000000000001';
ALTER TABLE public.activities ALTER COLUMN worksite_id SET DEFAULT '52504243-0000-4000-8000-000000000001';
ALTER TABLE public.activity_history ALTER COLUMN worksite_id SET DEFAULT '52504243-0000-4000-8000-000000000001';
ALTER TABLE public.sync_jobs ALTER COLUMN worksite_id SET DEFAULT '52504243-0000-4000-8000-000000000001';
ALTER TABLE public.sharepoint_config ALTER COLUMN worksite_id SET DEFAULT '52504243-0000-4000-8000-000000000001';
ALTER TABLE public.overtime_requests ALTER COLUMN worksite_id SET DEFAULT '52504243-0000-4000-8000-000000000001';
ALTER TABLE public.scheduled_transport_batches ALTER COLUMN worksite_id SET DEFAULT '52504243-0000-4000-8000-000000000001';
ALTER TABLE public.scheduled_transport_requests ALTER COLUMN worksite_id SET DEFAULT '52504243-0000-4000-8000-000000000001';
ALTER TABLE public.activity_edit_settings ALTER COLUMN worksite_id SET DEFAULT '52504243-0000-4000-8000-000000000001';

DO $optional_defaults$
BEGIN
  IF to_regclass('public.employees') IS NOT NULL THEN
    EXECUTE $$ALTER TABLE public.employees ALTER COLUMN worksite_id SET DEFAULT '52504243-0000-4000-8000-000000000001'$$;
  END IF;
  IF to_regclass('public.employee_days_off') IS NOT NULL THEN
    EXECUTE $$ALTER TABLE public.employee_days_off ALTER COLUMN worksite_id SET DEFAULT '52504243-0000-4000-8000-000000000001'$$;
  END IF;
END
$optional_defaults$;
