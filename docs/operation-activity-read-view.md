# Visualização do perfil Operação em Atividades

O perfil Operação consulta a mesma informação que Planejamento nesta tela: seleção das semanas recentes, localização da tarefa, conferência SAP, status e HH, filtros SAP, detalhamento das atividades fora da programação e impressão/exportação do recorte. O aviso do corte de datas também fica visível, sem liberar edição de data ou configuração.

Leitura e escrita têm controles distintos no cliente (`canViewSap` e `canImportSap`) e no banco (`can_view_activity_sap` e a autoridade original `can_access_sap`). A permissão de leitura exige usuário aprovado e continua limitada às obras autorizadas. As novas políticas das cargas e linhas SAP são exclusivamente SELECT. A apuração do RS, a disponibilidade e a importação continuam com as regras anteriores.

Os comandos de alteração não se equiparam ao Planejamento: Operação mantém somente N° PT, cores da PT e os status de PT previamente autorizados, incluindo lote. Não recebe acesso a importações, alteração de datas, liberação em lote ou edição geral dos campos da programação. Os formulários e seus validadores de escrita não são alterados.

Verificação: testes de perfil no cliente e teste transacional com um usuário real de Operação, sob o papel `authenticated` e RLS. A conferência e a página filtrada SAP retornaram os mesmos dados que Planejamento na mesma obra e semana. A tentativa de importação SAP foi negada. A apuração RS permaneceu negada. Usuário não aprovado continuou sem acesso. Nenhuma tarefa, carga, perfil ou atribuição de papel foi modificada durante esses testes.
