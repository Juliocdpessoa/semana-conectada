-- Replay protection for one caller's one import attempt; no historical loads change.
CREATE TABLE IF NOT EXISTS public.sap_confirmation_import_receipts(
 actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 request_id uuid NOT NULL,week_id uuid NOT NULL REFERENCES public.weeks(id) ON DELETE CASCADE,
 payload_hash text NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(actor_id,request_id));
ALTER TABLE public.sap_confirmation_import_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sap_confirmation_import_receipts FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.sap_confirmation_import_receipts TO service_role;
CREATE OR REPLACE FUNCTION public.import_sap_confirmations_once(p_request_id uuid,p_week_id uuid,p_source_file_name text,p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor uuid:=auth.uid();site uuid;fingerprint text;saved public.sap_confirmation_import_receipts%ROWTYPE;answer jsonb;
BEGIN
 IF actor IS NULL OR NOT coalesce(public.is_approved(actor),false) OR NOT coalesce(public.can_access_sap(actor),false)
 OR NOT coalesce(public.password_access_allowed(),false) THEN RAISE EXCEPTION 'Sem permissão para importar SAP.' USING ERRCODE='PT403'; END IF;
 SELECT worksite_id INTO site FROM public.weeks WHERE id=p_week_id;
 IF site IS NULL OR NOT coalesce(public.can_access_worksite(actor,site),false) THEN RAISE EXCEPTION 'Semana não encontrada ou sem acesso.' USING ERRCODE='PT403'; END IF;
 IF p_request_id IS NULL OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Importação inválida.' USING ERRCODE='PT400'; END IF;
 IF jsonb_array_length(p_rows) NOT BETWEEN 1 AND 5000 OR nullif(btrim(p_source_file_name),'') IS NULL THEN RAISE EXCEPTION 'Planilha SAP inválida.' USING ERRCODE='PT400'; END IF;
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('week',p_week_id,'file',p_source_file_name,'rows',p_rows)::text,'UTF8')),'hex');
 IF NOT pg_try_advisory_xact_lock(hashtextextended('nexo-sap-import:'||actor::text||':'||p_request_id::text,0)) THEN
  RAISE EXCEPTION 'Esta tentativa SAP ainda está em processamento. Aguarde e tente novamente nesta mesma prévia.' USING ERRCODE='PT409';
 END IF;
 SELECT * INTO saved FROM public.sap_confirmation_import_receipts WHERE actor_id=actor AND request_id=p_request_id;
 IF FOUND THEN
  IF saved.week_id<>p_week_id OR saved.payload_hash<>fingerprint THEN RAISE EXCEPTION 'A tentativa SAP não corresponde a esta planilha. Selecione novamente o arquivo.' USING ERRCODE='PT409'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.sap_confirmation_imports WHERE id=(saved.result->>'importId')::uuid AND week_id=p_week_id AND worksite_id=site) THEN
   RAISE EXCEPTION 'Esta carga SAP foi removida. Confira o histórico antes de selecionar novamente a planilha.' USING ERRCODE='PT409';
  END IF;
  RETURN saved.result||jsonb_build_object('replayed',true);
 END IF;
 -- Retain the canonical append-only importer, its validations, audit and calculations.
 answer:=public.import_sap_confirmations(p_week_id,p_source_file_name,p_rows);
 IF answer->>'ok' IS DISTINCT FROM 'true' OR answer->>'importId' IS NULL THEN RAISE EXCEPTION 'Resultado SAP não confirmado.'; END IF;
 INSERT INTO public.sap_confirmation_import_receipts(actor_id,request_id,week_id,payload_hash,result) VALUES(actor,p_request_id,p_week_id,fingerprint,answer);
 RETURN answer||jsonb_build_object('replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.import_sap_confirmations_once(uuid,uuid,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.import_sap_confirmations_once(uuid,uuid,text,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
