-- Inclui o número da PT na busca geral paginada sem alterar os demais filtros.
DO $migration$
DECLARE
  function_definition text;
  search_anchor text := 'OR lower(coalesce(b.reported_by_name,'''')) LIKE ''%''||p.search||''%'') pass_search';
  search_with_pt text := 'OR lower(coalesce(b.pt_number,'''')) LIKE ''%''||p.search||''%'' OR lower(coalesce(b.reported_by_name,'''')) LIKE ''%''||p.search||''%'') pass_search';
BEGIN
  SELECT pg_get_functiondef(
    'public.get_activities_page(uuid,jsonb,integer,integer)'::regprocedure
  ) INTO function_definition;

  IF position(search_anchor IN function_definition) = 0 THEN
    RAISE EXCEPTION 'Não foi possível localizar o trecho de busca de atividades.';
  END IF;

  EXECUTE replace(function_definition, search_anchor, search_with_pt);
END
$migration$;

