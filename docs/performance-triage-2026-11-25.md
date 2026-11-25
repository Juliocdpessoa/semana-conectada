# Distinção de sinais no painel de desempenho

Implementação local, não publicada. Somente apresentação sobre dados já retornados pela RPC administrativa existente; nenhuma nova consulta, migração, alteração de coleta ou escrita operacional. Mantém senha, aprovação, administração global/local e escopo de obra existentes.

## Critérios

- Verificar falhas: falhas nas amostras activities_list/activities_filter; separadamente diagnósticos não realtime ou realtime JWT/autorização/quota/replicação. São sinais para triagem, não prova de indisponibilidade. Não somar essas fontes pois podem representar o mesmo problema.
- Retorno de conexão confirmado: samples realtime_recovery bem-sucedidos. Não associar a um diagnóstico específico ou afirmar atualização de tarefa. Não prova ausência de ação do usuário.
- Impacto não confirmado: diagnósticos realtime de transporte/timeout/fechamento ou razão desconhecida. Nunca chamar de normal por ausência de reclamações nem persistente por falta de recuperação amostrada.
- Banco: locks, requisições authenticator ativas acima de cinco segundos ou slots inativos no retrato atual, apenas quando dados globais estiverem disponíveis. Sem histórico ou uptime inferido.

O painel passa a ter resumo acima das métricas e coluna Interpretação nas últimas trinta ocorrências. Contagens gerais são Diagnósticos/Eventos, não uma falsa contagem de quedas. Não inventa percentual de recuperação por subtração de samples independentes. Cobertura ausente fica explícita, inclusive entregas por tarefa, salvamentos e perda de dados não medidos.

## Observação de produção

25/11/2026 às 08:09:49 Brasília: desde 00:00 Brasília, 12 diagnósticos realtime/transport e um realtime/timeout; 16 filtros bem-sucedidos e um com falha nas amostras; sem locks nem authenticator ativo acima de cinco segundos no retrato. Não são contagens completas de uso/queda. Nenhum dado ou usuário alterado.

Consulta: agregações stage/category/realtime_reason/count sobre app_access_diagnostics e operation/success/count sobre app_performance_samples com received_at>='2026-11-25 03:00+00'; estado por pg_stat_activity. Essa evidência não foi embutida na interface: valores exibidos continuam vindos da consulta administrativa autorizada.

## Validação

286 testes Node passaram, incluindo quatro testes novos da triagem. TypeScript e build de produção concluídos sem erros. Casos: metadado ausente, código desconhecido, recovery maior que desconexões, consulta com falha, banco restrito e slots inativos. git diff --check passou. Revisão visual em navegador autenticado não realizada; não foi alegada validação visual nem confirmação em produção.

Não se trata de um novo dashboard Data/HTML ou Site: o painel React existente foi preservado com seus componentes e controle de acesso. O fluxo de revisão de painel orientou a semântica e a hierarquia sem substituir o aplicativo ou seu runtime.
