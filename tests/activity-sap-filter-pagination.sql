-- Run with the JWT sub of an approved planning/admin user already configured.
-- Read-only assertions; always roll back. Uses an accessible active week.
BEGIN;
SET LOCAL ROLE authenticated;
DO $test$
DECLARE week_id uuid; baseline jsonb; result jsonb; status_map jsonb; picked int; filters jsonb;
BEGIN
  IF NOT public.can_access_sap(auth.uid()) THEN RAISE EXCEPTION 'Configure um usuário de planejamento aprovado para o teste'; END IF;
  SELECT id INTO week_id FROM public.weeks WHERE is_active LIMIT 1;
  baseline := public.get_activities_page(week_id,'{}',0,5000);
  IF jsonb_array_length(baseline->'rows')=0 THEN RAISE EXCEPTION 'Semana sem atividades para testar'; END IF;
  SELECT jsonb_object_agg(row->>'id','Divergência'),count(*) INTO status_map,picked
    FROM (SELECT value row FROM jsonb_array_elements(baseline->'rows') LIMIT 5) x;
  result := public.get_activities_page(week_id,jsonb_build_object('sapStatusById',status_map,'sapStatuses',jsonb_build_array('Divergência')),0,2);
  IF (result->'kpis'->>'total')::int<>picked OR (result->'sapCounts'->>'Divergência')::int<>picked OR jsonb_array_length(result->'rows')<>least(2,picked) THEN
    RAISE EXCEPTION 'Contagem/paginação SAP incorreta';
  END IF;
  result := public.get_activities_page(week_id,jsonb_build_object('sapStatusById',status_map,'sapStatuses',jsonb_build_array('Aguardando confirmação')),0,50);
  IF (result->'kpis'->>'total')::int<>0 OR jsonb_array_length(result->'rows')<>0 THEN RAISE EXCEPTION 'Filtro sem correspondência incorreto'; END IF;
  SELECT jsonb_object_agg(value->>'id','Divergência') INTO status_map FROM jsonb_array_elements(baseline->'rows');
  filters := jsonb_build_object('dates',jsonb_build_array(baseline->'rows'->0->>'scheduled_date'));
  baseline := public.get_activities_page(week_id,filters,0,5000);
  result := public.get_activities_page(week_id,filters || jsonb_build_object('sapStatusById',status_map,'sapStatuses',jsonb_build_array('Divergência')),0,50);
  IF baseline->'kpis' IS DISTINCT FROM result->'kpis' OR baseline->'options' IS DISTINCT FROM result->'options' OR (result->'sapCounts'->>'Divergência')::int<>(baseline->'kpis'->>'total')::int THEN
    RAISE EXCEPTION 'Filtros encadeados/resumo divergentes';
  END IF;
END $test$;
ROLLBACK;
