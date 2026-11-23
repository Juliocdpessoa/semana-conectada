-- Metadata only; no historical rewrites or activity/account/permission changes.
ALTER TABLE public.app_access_diagnostics
 ADD COLUMN IF NOT EXISTS client_occurred_at timestamptz,
 ADD COLUMN IF NOT EXISTS app_release text CHECK(app_release IS NULL OR app_release ~ '^([a-f0-9]{40}|unavailable)$'),
 ADD COLUMN IF NOT EXISTS tab_visibility text CHECK(tab_visibility IS NULL OR tab_visibility IN ('visible','hidden','unknown')),
 ADD COLUMN IF NOT EXISTS client_online boolean;
COMMENT ON COLUMN public.app_access_diagnostics.client_occurred_at IS 'Untrusted bounded client occurrence time; received_at remains authoritative receipt time.';
COMMENT ON COLUMN public.app_access_diagnostics.app_release IS 'Build commit metadata, not an authorization or independently verified client identity.';
-- Existing SELECT RLS still controls which continuous rows subscribers can see.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='continuous_activities') THEN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.continuous_activities;
 END IF;
END $$;
