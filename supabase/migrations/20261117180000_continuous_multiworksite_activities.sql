CREATE TABLE public.activity_page_configs(
 worksite_id uuid PRIMARY KEY REFERENCES public.worksites(id),mode text NOT NULL CHECK(mode='continuous'),
 fields jsonb NOT NULL,statuses jsonb NOT NULL,version integer NOT NULL DEFAULT 1,
 updated_by uuid,updated_by_name text,updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.continuous_activities(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),worksite_id uuid NOT NULL REFERENCES public.activity_page_configs(worksite_id),
 record_key text NOT NULL CHECK(length(record_key) BETWEEN 1 AND 600),data jsonb NOT NULL,
 version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 updated_by uuid,updated_by_name text,UNIQUE(worksite_id,record_key));
CREATE TABLE public.continuous_activity_history(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),record_id uuid,worksite_id uuid NOT NULL,
 kind text NOT NULL,previous_data jsonb,new_data jsonb,actor uuid,actor_name text,changed_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.activity_page_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.continuous_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.continuous_activity_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY config_read ON public.activity_page_configs FOR SELECT TO authenticated USING(public.is_approved(auth.uid()) AND public.can_access_worksite(auth.uid(),worksite_id));
CREATE POLICY continuous_read ON public.continuous_activities FOR SELECT TO authenticated USING(public.is_approved(auth.uid()) AND public.can_access_worksite(auth.uid(),worksite_id));
CREATE POLICY continuous_history_read ON public.continuous_activity_history FOR SELECT TO authenticated USING(public.is_approved(auth.uid()) AND public.can_access_worksite(auth.uid(),worksite_id));
REVOKE ALL ON public.activity_page_configs,public.continuous_activities,public.continuous_activity_history FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.activity_page_configs,public.continuous_activities,public.continuous_activity_history TO authenticated;
INSERT INTO public.activity_page_configs(worksite_id,mode,fields,statuses) VALUES('68166d78-53b7-4c66-bea9-deb94e39a2c3','continuous','[{"key":"ss","label":"Nº S.S","type":"text","visible":true,"filter":false},{"key":"status","label":"Status","type":"status","visible":true,"filter":true},{"key":"requester","label":"Solicitante","type":"text","visible":true,"filter":true},{"key":"description","label":"Solicitação","type":"text","visible":true,"filter":false},{"key":"os","label":"Nº O.S","type":"text","visible":true,"filter":false},{"key":"budget","label":"Nº orçamento","type":"text","visible":true,"filter":false},{"key":"budget_type","label":"Tipo de orçamento","type":"text","visible":true,"filter":true},{"key":"local","label":"Local","type":"text","visible":true,"filter":true},{"key":"sector","label":"Setor","type":"text","visible":true,"filter":true},{"key":"criticality","label":"Criticidade","type":"text","visible":true,"filter":true},{"key":"requested_date","label":"Data S.S","type":"date","visible":true,"filter":false},{"key":"contract_date","label":"Data contrato","type":"date","visible":true,"filter":false},{"key":"sent_date","label":"Data envio","type":"date","visible":true,"filter":false},{"key":"approved_date","label":"Data aprovação","type":"date","visible":true,"filter":false},{"key":"finished_date","label":"Data fim","type":"date","visible":true,"filter":false},{"key":"value","label":"Valor","type":"number","visible":true,"filter":false},{"key":"value_bdi","label":"Valor com BDI","type":"number","visible":true,"filter":false},{"key":"measurement","label":"Medição","type":"text","visible":true,"filter":false},{"key":"progress","label":"Previsão de avanço","type":"text","visible":true,"filter":false},{"key":"notes","label":"Observações","type":"text","visible":true,"filter":false}]','[{"key":"1","label":"LIBERAÇÃO","color":"#64748b","active":true},{"key":"2","label":"ORÇAMENTO","color":"#d97706","active":true},{"key":"3","label":"APROVAÇÃO","color":"#7c3aed","active":true},{"key":"4","label":"EXECUÇÃO","color":"#2563eb","active":true},{"key":"5","label":"COBRANÇA","color":"#0891b2","active":true},{"key":"6","label":"MEDIDO","color":"#16a34a","active":true},{"key":"7","label":"CANCELADO","color":"#dc2626","active":true},{"key":"8","label":"RESSARCIMENTO","color":"#475569","active":true}]');
CREATE FUNCTION public.save_continuous_activity(p_worksite uuid,p_key text,p_data jsonb,p_id uuid DEFAULT NULL,p_version integer DEFAULT 0) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE cfg public.activity_page_configs%ROWTYPE; old public.continuous_activities%ROWTYPE; saved public.continuous_activities%ROWTYPE; field_item jsonb; actor_name text;
BEGIN
 IF NOT coalesce(public.password_access_allowed(),false) OR NOT coalesce(public.can_access_sap(auth.uid()),false) OR NOT coalesce(public.can_access_worksite(auth.uid(),p_worksite),false) THEN RAISE EXCEPTION 'Sem permissão para editar atividades desta obra'; END IF;
 SELECT * INTO cfg FROM public.activity_page_configs WHERE worksite_id=p_worksite;
 IF NOT FOUND OR jsonb_typeof(p_data)<>'object' OR length(p_data::text)>50000 OR length(btrim(p_key)) NOT BETWEEN 1 AND 20000 THEN RAISE EXCEPTION 'Registro inválido'; END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(cfg.statuses) s WHERE s->>'key'=p_data->>'status' AND coalesce((s->>'active')::boolean,true)) AND NOT EXISTS(SELECT 1 FROM public.continuous_activities a WHERE a.id=p_id AND a.worksite_id=p_worksite AND a.data->>'status'=p_data->>'status') THEN RAISE EXCEPTION 'Status inválido ou desativado'; END IF;
 IF length(btrim(coalesce(p_data->>'description',''))) NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'Informe a solicitação'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_data) k WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(cfg.fields) f WHERE f->>'key'=k)) THEN RAISE EXCEPTION 'Campo não configurado'; END IF;
 FOR field_item IN SELECT * FROM jsonb_array_elements(cfg.fields) LOOP
 IF nullif(p_data->> (field_item->>'key'),'') IS NOT NULL THEN
 IF field_item->>'type'='number' AND (jsonb_typeof(p_data->(field_item->>'key'))<>'number' OR (p_data->>(field_item->>'key'))::numeric<0) THEN RAISE EXCEPTION 'Valor numérico inválido: %',field_item->>'label'; END IF;
 IF field_item->>'type'='date' THEN PERFORM (p_data->>(field_item->>'key'))::date; END IF;
 END IF; END LOOP;
 SELECT full_name INTO actor_name FROM public.profiles WHERE id=auth.uid();
 IF p_id IS NULL THEN
 INSERT INTO public.continuous_activities(worksite_id,record_key,data,updated_by,updated_by_name) VALUES(p_worksite,encode(sha256(convert_to(btrim(p_key),'UTF8')),'hex'),p_data,auth.uid(),actor_name) RETURNING * INTO saved;
 ELSE
 SELECT * INTO old FROM public.continuous_activities WHERE id=p_id AND worksite_id=p_worksite FOR UPDATE;
 IF NOT FOUND OR old.version<>p_version THEN RAISE EXCEPTION 'Registro alterado por outra pessoa. Atualize antes de salvar.' USING ERRCODE='40001'; END IF;
 UPDATE public.continuous_activities SET data=p_data,version=version+1,updated_at=now(),updated_by=auth.uid(),updated_by_name=actor_name WHERE id=old.id RETURNING * INTO saved;
 END IF;
 INSERT INTO public.continuous_activity_history(record_id,worksite_id,kind,previous_data,new_data,actor,actor_name) VALUES(saved.id,p_worksite,CASE WHEN p_id IS NULL THEN 'created' ELSE 'updated' END,old.data,saved.data,auth.uid(),actor_name);
 RETURN jsonb_build_object('id',saved.id,'version',saved.version);
END $$;
CREATE FUNCTION public.import_continuous_activities(p_worksite uuid,p_rows jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r jsonb;n integer:=0;skipped integer:=0;
BEGIN
 IF NOT coalesce(public.password_access_allowed(),false) OR NOT coalesce(public.can_access_sap(auth.uid()),false) OR NOT coalesce(public.can_access_worksite(auth.uid(),p_worksite),false) THEN RAISE EXCEPTION 'Sem acesso à importação'; END IF;
 IF jsonb_typeof(p_rows)<>'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Lote inválido'; END IF;
 FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
 BEGIN
 PERFORM public.save_continuous_activity(p_worksite,r->>'key',r->'data');
 n:=n+1;
 EXCEPTION WHEN unique_violation THEN skipped:=skipped+1;
 END;
 END LOOP;
 RETURN jsonb_build_object('inserted',n,'skipped',skipped);
END $$;
CREATE FUNCTION public.save_activity_page_config(p_worksite uuid,p_fields jsonb,p_statuses jsonb,p_version integer) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE old public.activity_page_configs%ROWTYPE; actor_name text;
BEGIN
 IF NOT coalesce(public.password_access_allowed(),false) OR NOT coalesce(public.is_approved(auth.uid()),false) OR NOT coalesce(public.has_role(auth.uid(),'admin'),false) OR NOT coalesce(public.can_access_worksite(auth.uid(),p_worksite),false) THEN RAISE EXCEPTION 'Somente administrador da obra'; END IF;
 SELECT * INTO old FROM public.activity_page_configs WHERE worksite_id=p_worksite FOR UPDATE;
 IF NOT FOUND OR old.version<>p_version THEN RAISE EXCEPTION 'Configuração alterada. Atualize a página.'; END IF;
 IF jsonb_typeof(p_fields)<>'array' OR jsonb_typeof(p_statuses)<>'array' OR jsonb_array_length(p_statuses) NOT BETWEEN 1 AND 40 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_statuses) s WHERE (s->>'active')::boolean) THEN RAISE EXCEPTION 'Configuração inválida'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(old.fields) f WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_fields) n WHERE n->>'key'=f->>'key' AND n->>'type'=f->>'type'))
 OR jsonb_array_length(p_fields)<>jsonb_array_length(old.fields) THEN RAISE EXCEPTION 'Não é permitido apagar campos ou alterar os tipos existentes'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_fields) f WHERE length(btrim(f->>'label')) NOT BETWEEN 1 AND 100) THEN RAISE EXCEPTION 'Nome de coluna inválido'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_statuses) s WHERE length(btrim(s->>'key')) NOT BETWEEN 1 AND 40 OR length(btrim(s->>'label')) NOT BETWEEN 1 AND 100 OR coalesce(s->>'color','') !~ '^#[0-9a-fA-F]{6}$')
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_statuses) s GROUP BY s->>'key' HAVING count(*)>1)
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(old.statuses) s WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_statuses) n WHERE n->>'key'=s->>'key')) THEN RAISE EXCEPTION 'Status inválido: desative em vez de excluir'; END IF;
 SELECT full_name INTO actor_name FROM public.profiles WHERE id=auth.uid();
 UPDATE public.activity_page_configs SET fields=p_fields,statuses=p_statuses,version=version+1,updated_by=auth.uid(),updated_by_name=actor_name,updated_at=now() WHERE worksite_id=p_worksite;
 INSERT INTO public.continuous_activity_history(worksite_id,kind,previous_data,new_data,actor,actor_name) VALUES(p_worksite,'configuration',jsonb_build_object('fields',old.fields,'statuses',old.statuses),jsonb_build_object('fields',p_fields,'statuses',p_statuses),auth.uid(),actor_name);
END $$;
REVOKE ALL ON FUNCTION public.save_continuous_activity(uuid,text,jsonb,uuid,integer),public.import_continuous_activities(uuid,jsonb),public.save_activity_page_config(uuid,jsonb,jsonb,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_continuous_activity(uuid,text,jsonb,uuid,integer),public.import_continuous_activities(uuid,jsonb),public.save_activity_page_config(uuid,jsonb,jsonb,integer) TO authenticated;

CREATE FUNCTION public.continuous_activity_options(p_worksite uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 IF NOT coalesce(public.password_access_allowed(),false) OR NOT coalesce(public.is_approved(auth.uid()),false) OR NOT coalesce(public.can_access_worksite(auth.uid(),p_worksite),false) THEN RAISE EXCEPTION 'Sem acesso'; END IF;
 SELECT coalesce(jsonb_object_agg(key,vals),'{}') INTO result FROM (
 SELECT f->>'key' key,coalesce((SELECT jsonb_agg(v ORDER BY v) FROM (SELECT DISTINCT a.data->>(f->>'key') v FROM public.continuous_activities a WHERE a.worksite_id=p_worksite AND nullif(a.data->>(f->>'key'),'') IS NOT NULL ORDER BY 1 LIMIT 1000) options),'[]') vals
 FROM public.activity_page_configs c CROSS JOIN LATERAL jsonb_array_elements(c.fields) f WHERE c.worksite_id=p_worksite AND (f->>'filter')::boolean) q;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.continuous_activity_options(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.continuous_activity_options(uuid) TO authenticated;

CREATE POLICY password_change_gate ON public.activity_page_configs AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.password_access_allowed())) WITH CHECK ((SELECT public.password_access_allowed()));
CREATE POLICY password_change_gate ON public.continuous_activities AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.password_access_allowed())) WITH CHECK ((SELECT public.password_access_allowed()));
CREATE POLICY password_change_gate ON public.continuous_activity_history AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.password_access_allowed())) WITH CHECK ((SELECT public.password_access_allowed()));
