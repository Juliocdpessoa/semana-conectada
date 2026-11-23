# Desempenho — leitura auxiliar SAP em Atividades

## Baseline

Em 23/11/2026, às 14h14 Brasília, a última hora de telemetria tinha 83 amostras de filtros, zero falhas, p50 402 ms, p95 1.033 ms e máximo 3.482 ms. Seis amostras de lista, zero falhas, p50 401 ms e p95 1.320 ms. Retrato de banco: zero esperas por lock e zero consultas authenticator ativas acima de cinco segundos. São amostras ponta a ponta de leituras, não uptime, renderização completa ou garantia de capacidade.

## Trabalho redundante encontrado

sapAllocationActivities carregava todas as tarefas em páginas de 500 pela RPC get_activities_page, que também calcula cartões, opções de filtros e progresso SAP. Esses resultados adicionais eram descartados nessa consulta auxiliar. Na semana ativa 048, com 1.472 tarefas, eram três chamadas completas e cerca de 2,41 MB de JSON sem compressão apenas para essa etapa.

## Otimização

Nova função STABLE SECURITY INVOKER get_activity_sap_allocation_page devolve somente id, ordem, planning_data, data e linha de origem, além de totalAll. São todos os inputs consumidos pela lógica de distribuição SAP existente. Mantém planning_data integral para não alterar interpretação de campos. Ordenação e limites de paginação mantidos. Consulta a mesma activities sob as mesmas RLS, password gate e permissão can_view_activity_sap do chamador. Execute anon/public revogado; authenticated com os guardas existentes. Nenhuma política ou dado alterado.

O cliente muda somente a consulta auxiliar; paginação, concorrência máxima de duas páginas adicionais, cancelamento, staleTime e lógica de rateio permanecem. Tipagem reduzida evita dependência acidental de campos não carregados. A consulta da tela/filtros, RS e apropriações não foram reescritas.

O relay aceita apenas o novo RPC read-only com semana UUID, página 0..10000 e tamanho 1..5000. Não aceita filtros arbitrários, ator, URL ou writes. O cliente continua usando JWT/RLS e o transporte com deadline existente.

## Medição comparativa

Teste de leitura sob papel authenticated e contexto do administrador solicitante, mesma semana, mesmas páginas e mesma projeção JSON validada por igualdade. A candidata foi criada em transação revertida durante a comparação. Sem teste de carga ou concorrência sintética.

| Página | Linhas | Antes (ms) | Depois (ms) | JSON antes (bytes) | JSON depois (bytes) |
| --- | ---: | ---: | ---: | ---: | ---: |
| 0 | 500 | 171,01 | 34,12 | 820247 | 369742 |
| 1 | 500 | 146,27 | 30,72 | 821241 | 368690 |
| 2 | 472 | 144,88 | 29,53 | 768045 | 348332 |

Soma das execuções do banco: 462,16 → 94,37 ms, cerca de 80% menor nessa etapa. JSON bruto total: 2.409.533 → 1.086.764 bytes, cerca de 55% menor. Não representa ganho de 80% no aplicativo inteiro, nem tempo de transferência comprimida, nem resultado na rede Petrobras. Amostras anteriores de EXPLAIN deram 174,006 ms para a chamada completa e 50,686 ms para a enxuta, mostrando variação normal entre execuções.

## Validação e rollout

Igualdade de todas as 1.472 linhas projetadas, contagem e ordem nas três páginas. Validação read-only adicional em nove contextos (oito roles e outra obra): projeção igual à fonte anterior quando autorizado; zero linhas sem permissão/fora da obra; execução anônima negada. A migration foi então aplicada; STABLE/invoker e ACL conferidos.

280 testes Node e 51 testes Bun de transporte com SDK 2.110.7 passaram. O novo RPC foi exercitado no relay com fetch simulado, corpo validado, sem tokens/dados reais ou network real. TypeScript e build de produção passaram. Nenhuma amostra falsa foi inserida na telemetria.

O banco está preparado, mas o aplicativo ainda precisa ser publicado para usar a nova leitura. Só após a publicação e adoção pelos navegadores será possível medir o impacto real. Próximos focos devem partir de novos tempos observados, sem aumentar intervalos de desatualização, remover permissões ou escalar infraestrutura sem evidência.
