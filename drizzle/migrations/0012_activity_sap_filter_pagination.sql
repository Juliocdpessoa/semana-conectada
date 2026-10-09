-- Pagina e agrega o filtro SAP na mesma consulta dos demais filtros.
-- O mapa contém o status efetivo já calculado pela tela (incluindo HH por dia).
-- É somente um critério de visualização: não grava/reescreve status oficiais.
-- SECURITY INVOKER e a função original são mantidos, preservando RLS.
DO $migration$
DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef('public.get_activities_page(uuid,jsonb,integer,integer)'::regprocedure)
    INTO definition;
  IF position('sapStatusById' IN definition) > 0 THEN RETURN; END IF;
  IF position('SELECT a.*,' IN definition) = 0
    OR position('coalesce(p_filters->''origins'',''[]''::jsonb) origins' IN definition) = 0
    OR position('pass_date AND pass_origin' IN definition) = 0 THEN
    RAISE EXCEPTION 'Formato da consulta de atividades incompatível; nenhuma alteração aplicada.';
  END IF;

  definition := replace(definition,
    'coalesce(p_filters->''origins'',''[]''::jsonb) origins',
    'coalesce(p_filters->''origins'',''[]''::jsonb) origins,
     CASE WHEN (SELECT public.can_access_sap(auth.uid())) THEN coalesce(p_filters->''sapStatuses'',''[]''::jsonb) ELSE ''[]''::jsonb END sap_statuses');
  definition := replace(definition, 'SELECT a.*,',
    'SELECT a.*,
     CASE WHEN (SELECT public.can_access_sap(auth.uid())) THEN p_filters->''sapStatusById''->>a.id::text END AS effective_sap_status,');
  definition := replace(definition, 'SELECT b.*,',
    'SELECT b.*,
     (jsonb_array_length(p.sap_statuses)=0 OR p.sap_statuses ? coalesce(b.effective_sap_status,'''')) pass_sap,');
  definition := replace(definition, 'FROM marked WHERE', 'FROM marked WHERE pass_sap AND');
  definition := replace(definition,
    'ARRAY[''area_label''', 'ARRAY[''effective_sap_status'',''pass_sap'',''area_label''');
  definition := replace(definition, '''totalAll'',',
    '''sapCounts'',coalesce((SELECT jsonb_object_agg(sap_status,total) FROM
      (SELECT effective_sap_status sap_status,count(*)::integer total FROM filtered
       WHERE effective_sap_status IS NOT NULL GROUP BY effective_sap_status) counts),''{}''::jsonb),
     ''totalAll'',');
  EXECUTE definition;
END
$migration$;
