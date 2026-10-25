-- Private, deduplicated SAP + RS snapshots. No source/history rows are deleted.
CREATE TABLE public.nexo_backup_devices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), worksite_id uuid NOT NULL REFERENCES public.worksites(id),
 name text NOT NULL, token_hash text NOT NULL UNIQUE CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz, last_seen_at timestamptz
);
CREATE TABLE public.nexo_backup_chunks (
 worksite_id uuid NOT NULL REFERENCES public.worksites(id), sha256 text NOT NULL, payload text NOT NULL,
 PRIMARY KEY(worksite_id,sha256)
);
CREATE TABLE public.nexo_backup_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), worksite_id uuid NOT NULL REFERENCES public.worksites(id),
 week_id uuid REFERENCES public.weeks(id) ON DELETE SET NULL, basis_version integer NOT NULL,
 captured_at timestamptz NOT NULL DEFAULT now(), manifest text NOT NULL, manifest_sha256 text NOT NULL,
 delivered_at timestamptz, delivered_device uuid REFERENCES public.nexo_backup_devices(id),
 UNIQUE(week_id,basis_version)
);
CREATE TABLE public.nexo_backup_job_chunks (
 job_id uuid NOT NULL REFERENCES public.nexo_backup_jobs(id), worksite_id uuid NOT NULL,
 sha256 text NOT NULL, PRIMARY KEY(job_id,sha256),
 FOREIGN KEY(worksite_id,sha256) REFERENCES public.nexo_backup_chunks(worksite_id,sha256)
);
CREATE INDEX nexo_backup_pending ON public.nexo_backup_jobs(worksite_id,captured_at) WHERE delivered_at IS NULL;
ALTER TABLE public.nexo_backup_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nexo_backup_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nexo_backup_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nexo_backup_job_chunks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nexo_backup_devices,public.nexo_backup_chunks,public.nexo_backup_jobs,public.nexo_backup_job_chunks FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.capture_nexo_backup(p_week uuid,p_version integer) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE site uuid; jid uuid:=gen_random_uuid(); tbl text; predicate text; part record;
 entries jsonb:='[]'; body text; digest_text text; doc text; export_sql text:='';
BEGIN
 SELECT worksite_id INTO STRICT site FROM public.weeks WHERE id=p_week;
 PERFORM pg_advisory_xact_lock(hashtextextended('nexo-backup:'||site,0));
 SELECT id INTO jid FROM public.nexo_backup_jobs WHERE week_id=p_week AND basis_version=p_version;
 IF FOUND THEN RETURN jid; END IF;
 jid:=gen_random_uuid();
 -- Explicit allowlist: no auth users, credentials, role tables or unrelated modules.
 FOREACH tbl IN ARRAY ARRAY['worksites','weeks','activities','activity_history','sap_confirmation_imports',
 'sap_confirmation_rows','weekly_rs_availability','weekly_rs_availability_history','weekly_rs_program_bases',
 'weekly_rs_program_base_history','weekly_rs_closures','weekly_rs_closure_scopes','weekly_rs_closure_items'] LOOP
  predicate:=CASE WHEN tbl='worksites' THEN 's.id=$1'
   WHEN tbl IN ('weekly_rs_closure_scopes','weekly_rs_closure_items') THEN 'EXISTS(SELECT 1 FROM public.weekly_rs_closures c WHERE c.id=s.closure_id AND c.worksite_id=$1)'
   ELSE 's.worksite_id=$1' END;
  export_sql:=export_sql||CASE WHEN export_sql='' THEN '' ELSE ' UNION ALL ' END||format('(WITH records AS MATERIALIZED (SELECT to_jsonb(s) r FROM public.%I s WHERE %s), numbered AS (SELECT r,row_number() OVER(ORDER BY coalesce(r->>''id'',r->>''week_id'',r->>''closure_id''),r->>''version'',r->>''scope'') pos FROM records) SELECT %L::text tbl,(pos-1)/500 n,jsonb_agg(r ORDER BY pos)::text payload,count(*) total FROM numbered GROUP BY (pos-1)/500)',tbl,predicate,tbl);
 END LOOP;
 -- One statement snapshot across every table, including concurrent user changes.
 FOR part IN EXECUTE export_sql USING site LOOP
   body:=part.payload;
   digest_text:=encode(digest(convert_to(body,'UTF8'),'sha256'),'hex');
   INSERT INTO public.nexo_backup_chunks VALUES(site,digest_text,body) ON CONFLICT DO NOTHING;
   entries:=entries||jsonb_build_array(jsonb_build_object('file',part.tbl||'/'||lpad(part.n::text,6,'0')||'.json','sha256',digest_text,'rows',part.total));
 END LOOP;
 doc:=jsonb_build_object('format','nexo-sap-rs-v1','id',jid,'worksite_id',site,'trigger_week_id',p_week,
 'basis_version',p_version,'captured_at',transaction_timestamp(),'scope','SAP, programação, apontamentos, disponibilidade, bases e fechamentos RS; não inclui autenticação nem outros módulos',
 'tables',ARRAY['worksites','weeks','activities','activity_history','sap_confirmation_imports','sap_confirmation_rows','weekly_rs_availability','weekly_rs_availability_history','weekly_rs_program_bases','weekly_rs_program_base_history','weekly_rs_closures','weekly_rs_closure_scopes','weekly_rs_closure_items'],
 'entries',entries)::text;
 INSERT INTO public.nexo_backup_jobs(id,worksite_id,week_id,basis_version,manifest,manifest_sha256)
 VALUES(jid,site,p_week,p_version,doc,encode(digest(convert_to(doc,'UTF8'),'sha256'),'hex'));
 INSERT INTO public.nexo_backup_job_chunks SELECT DISTINCT jid,site,e->>'sha256' FROM jsonb_array_elements(entries) e;
 RETURN jid;
END $$;
REVOKE ALL ON FUNCTION public.capture_nexo_backup(uuid,integer) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.capture_nexo_backup_after_basis() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 -- History is written after the basis and all operational import rows exist.
 PERFORM public.capture_nexo_backup(NEW.week_id,NEW.version);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.capture_nexo_backup_after_basis() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER nexo_backup_after_basis AFTER INSERT ON public.weekly_rs_program_base_history
FOR EACH ROW EXECUTE FUNCTION public.capture_nexo_backup_after_basis();

CREATE FUNCTION public.nexo_backup_device(p_token text) RETURNS public.nexo_backup_devices
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE d public.nexo_backup_devices;
BEGIN
 IF p_token IS NULL OR p_token !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Dispositivo não autorizado'; END IF;
 SELECT * INTO d FROM public.nexo_backup_devices WHERE token_hash=encode(digest(convert_to(p_token,'UTF8'),'sha256'),'hex') AND revoked_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'Dispositivo não autorizado'; END IF;
 UPDATE public.nexo_backup_devices SET last_seen_at=now() WHERE id=d.id;
 RETURN d;
END $$;
REVOKE ALL ON FUNCTION public.nexo_backup_device(text) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.nexo_backup_poll(p_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE d public.nexo_backup_devices; j public.nexo_backup_jobs;
BEGIN
 d:=public.nexo_backup_device(p_token);
 SELECT * INTO j FROM public.nexo_backup_jobs WHERE worksite_id=d.worksite_id AND delivered_at IS NULL ORDER BY captured_at,id LIMIT 1;
 IF NOT FOUND THEN RETURN jsonb_build_object('pending',false); END IF;
 RETURN jsonb_build_object('pending',true,'id',j.id,'manifest',j.manifest,'sha256',j.manifest_sha256);
END $$;
CREATE FUNCTION public.nexo_backup_chunk(p_token text,p_job uuid,p_sha256 text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE d public.nexo_backup_devices; body text;
BEGIN
 d:=public.nexo_backup_device(p_token);
 SELECT c.payload INTO body FROM public.nexo_backup_chunks c JOIN public.nexo_backup_job_chunks r USING(worksite_id,sha256)
 JOIN public.nexo_backup_jobs j ON j.id=r.job_id
 WHERE j.id=p_job AND j.worksite_id=d.worksite_id AND c.sha256=p_sha256 AND j.delivered_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'Parte de backup indisponível'; END IF;
 RETURN jsonb_build_object('payload',body,'sha256',p_sha256);
END $$;
CREATE FUNCTION public.nexo_backup_ack(p_token text,p_job uuid,p_manifest_sha256 text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE d public.nexo_backup_devices;
BEGIN
 d:=public.nexo_backup_device(p_token);
 PERFORM pg_advisory_xact_lock(hashtextextended('nexo-backup:'||d.worksite_id,0));
 IF NOT EXISTS(SELECT 1 FROM public.nexo_backup_jobs WHERE id=p_job AND worksite_id=d.worksite_id AND manifest_sha256=p_manifest_sha256) THEN RAISE EXCEPTION 'Backup ou integridade inválida'; END IF;
 UPDATE public.nexo_backup_jobs SET delivered_at=coalesce(delivered_at,now()),delivered_device=coalesce(delivered_device,d.id) WHERE id=p_job AND worksite_id=d.worksite_id;
 DELETE FROM public.nexo_backup_job_chunks WHERE job_id=p_job;
 -- Only temporary snapshot payloads acknowledged by the receiving device are removed.
 DELETE FROM public.nexo_backup_chunks c WHERE c.worksite_id=d.worksite_id AND NOT EXISTS(SELECT 1 FROM public.nexo_backup_job_chunks r WHERE r.worksite_id=c.worksite_id AND r.sha256=c.sha256);
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.nexo_backup_poll(text),public.nexo_backup_chunk(text,uuid,text),public.nexo_backup_ack(text,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nexo_backup_poll(text),public.nexo_backup_chunk(text,uuid,text),public.nexo_backup_ack(text,uuid,text) TO anon,authenticated;

CREATE FUNCTION public.get_nexo_backup_status(p_worksite uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT coalesce(public.can_access_sap(auth.uid()),false) OR NOT coalesce(public.can_access_worksite(auth.uid(),p_worksite),false) THEN RAISE EXCEPTION 'Sem acesso'; END IF;
 RETURN jsonb_build_object('pending',(SELECT count(*) FROM public.nexo_backup_jobs WHERE worksite_id=p_worksite AND delivered_at IS NULL),
 'lastCaptured',(SELECT max(captured_at) FROM public.nexo_backup_jobs WHERE worksite_id=p_worksite),
 'lastDelivered',(SELECT max(delivered_at) FROM public.nexo_backup_jobs WHERE worksite_id=p_worksite),
 'deviceLastSeen',(SELECT max(last_seen_at) FROM public.nexo_backup_devices WHERE worksite_id=p_worksite AND revoked_at IS NULL));
END $$;
REVOKE ALL ON FUNCTION public.get_nexo_backup_status(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_nexo_backup_status(uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
