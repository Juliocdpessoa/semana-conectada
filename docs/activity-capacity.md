# Capacidade diária na tela de atividades

- Fonte: `activities.planning_data.Trab` (aliases TRAB/trab), data atual `scheduled_date`, centro CenTrab/CENTRO_DE_TRABALHO/Centro de trabalho. Não usa o centro como especialidade por suposição.
- Inclui tarefas agendadas, inclusive imediatas e Alpinismo. Canceladas não consomem capacidade. Outros status não retiram carga originalmente programada.
- Disponibilidade: tabela semanal `weekly_rs_availability`, somada por centro + data, incluindo os locais da mesma equipe. Não cria capacidade a partir de outra semana.
- Cada grupo calcula `max(programado - disponível, 0)`. O cartão soma os excessos, nunca diferenças líquidas entre centros/dias.
- Apenas filtros de centro de trabalho e data afetam o cartão; status, cor, busca e demais filtros da tabela não escondem carga daquele centro/dia. A restrição fica explícita no detalhe.
- Sem disponibilidade, centro/data ou HH válido: grupo sem conferência, não zero. Com cobertura parcial, o cartão indica um mínimo conhecido (`≥`). Disponibilidade explicitamente zero é válida.
- Uma RPC agregada por semana é compartilhada pelo cache; mudar filtros não baixa atividades nem provoca nova consulta. Atualização após alterações via invalidação existente/realtime; recarga a cada 60 segundos e botão manual para mudanças da disponibilidade.
- Movimentações individuais, arraste, colagem e preenchimento em lote comparam agregados antes/depois no servidor. Alertam sobre excesso criado ou aumentado. Falha na conferência avisa separadamente e nunca desfaz uma alteração salva. Número/cor de PT sem mudança de data não dispara comparação de capacidade.
- RPC somente para usuários aprovados da obra selecionada, respeitando visibilidade da semana em preparação. Não concede leitura da tabela editável de HH nem acesso a SAP.
- Não altera tarefas, histórico, fonte SAP ou disponibilidade. O histórico de mudança de data continua sendo o já existente; o alerta é informativo.

Validação: testes Node das funções de filtro/excesso/alerta; testes SQL transacionais com rollback; build Vite. Dados sintéticos só existem dentro da transação de teste.
