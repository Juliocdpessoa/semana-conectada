CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE TABLE public.nexo_backup_capture_queue(
 week_id uuid NOT NULL REFERENCES public.weeks(id) ON DELETE CASCADE,
 basis_version integer NOT NULL,requested_at timestamptz NOT NULL DEFAULT now(),
 attempts integer NOT NULL DEFAULT 0,next_attempt_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz,last_error text,PRIMARY KEY(week_id,basis_version));
ALTER TABLE public.nexo_backup_capture_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nexo_backup_capture_queue FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.capture_nexo_backup_after_basis() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 INSERT INTO public.nexo_backup_capture_queue(week_id,basis_version) VALUES(NEW.week_id,NEW.version) ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.process_nexo_backup_queue() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE job record;
BEGIN
 IF NOT pg_try_advisory_xact_lock(hashtextextended('nexo-backup-worker',0)) THEN RETURN; END IF;
 FOR job IN SELECT * FROM public.nexo_backup_capture_queue WHERE completed_at IS NULL AND next_attempt_at<=now() ORDER BY requested_at LIMIT 1 FOR UPDATE SKIP LOCKED LOOP
  BEGIN
   PERFORM public.capture_nexo_backup(job.week_id,job.basis_version);
   UPDATE public.nexo_backup_capture_queue SET completed_at=clock_timestamp(),attempts=attempts+1,last_error=NULL WHERE week_id=job.week_id AND basis_version=job.basis_version;
  EXCEPTION WHEN query_canceled OR OTHERS THEN
   UPDATE public.nexo_backup_capture_queue SET attempts=attempts+1,last_error=SQLSTATE,next_attempt_at=now()+interval '5 minutes' WHERE week_id=job.week_id AND basis_version=job.basis_version;
  END;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.process_nexo_backup_queue() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.capture_nexo_backup_after_basis() FROM PUBLIC,anon,authenticated;
SELECT cron.schedule('nexo-backup-capture-worker','* * * * *',$job$SET statement_timeout='120s'; SELECT public.process_nexo_backup_queue();$job$);
INSERT INTO public.nexo_backup_capture_queue(week_id,basis_version)
 SELECT b.week_id,b.version FROM public.weekly_rs_program_bases b WHERE NOT EXISTS(SELECT 1 FROM public.nexo_backup_jobs j WHERE j.week_id=b.week_id AND j.basis_version=b.version)
 ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.get_nexo_backup_status(p_worksite uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
 IF NOT coalesce(public.can_access_sap(auth.uid()),false) OR NOT coalesce(public.can_access_worksite(auth.uid(),p_worksite),false) THEN RAISE EXCEPTION 'Sem acesso'; END IF;
 RETURN jsonb_build_object('pending',(SELECT count(*) FROM public.nexo_backup_jobs WHERE worksite_id=p_worksite AND delivered_at IS NULL),
 'capturePending',(SELECT count(*) FROM public.nexo_backup_capture_queue q JOIN public.weeks w ON w.id=q.week_id WHERE w.worksite_id=p_worksite AND q.completed_at IS NULL),
 'captureFailures',(SELECT count(*) FROM public.nexo_backup_capture_queue q JOIN public.weeks w ON w.id=q.week_id WHERE w.worksite_id=p_worksite AND q.completed_at IS NULL AND q.last_error IS NOT NULL),
 'lastCaptured',(SELECT max(captured_at) FROM public.nexo_backup_jobs WHERE worksite_id=p_worksite),
 'lastDelivered',(SELECT max(delivered_at) FROM public.nexo_backup_jobs WHERE worksite_id=p_worksite),
 'deviceLastSeen',(SELECT max(last_seen_at) FROM public.nexo_backup_devices WHERE worksite_id=p_worksite AND revoked_at IS NULL));
END $function$
;
