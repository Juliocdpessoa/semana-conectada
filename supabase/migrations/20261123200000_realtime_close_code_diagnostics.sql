-- Additive, untrusted diagnostic metadata. No change to access or business data.
ALTER TABLE public.app_access_diagnostics
 ADD COLUMN IF NOT EXISTS realtime_close_code integer
 CHECK (realtime_close_code BETWEEN 1000 AND 4999);
COMMENT ON COLUMN public.app_access_diagnostics.realtime_close_code IS
 'Untrusted numeric websocket close code. Not proof of root cause; no raw reason or payload stored.';
