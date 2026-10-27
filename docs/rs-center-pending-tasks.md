# RS: tarefas sem apropriação por centro

Ao expandir uma especialidade e clicar em um centro, a tabela exibe abaixo dele as tarefas da programação sem apropriação na carga SAP do recorte. A consulta ocorre apenas ao abrir o detalhamento. Mostra semana, data, ordem, operação/suboperação, descrição, status operacional, justificativa, observações e autor/data da justificativa quando esses registros existem.

Sem justificativa, a interface informa “Sem justificativa registrada”. EXECUTADO sem apropriação recebe o rótulo “Executada, sem apropriação SAP”. O sistema não deduz um motivo de não execução a partir da ausência de SAP. Não há controles de alteração nessa lista.

A base oficial do RS é semanal por confirmação normalizada. Por isso, qualquer apropriação confirmada com HH positivo na semana, inclusive parcial, exclui a confirmação desta lista. Datas do acompanhamento diário não redefinem a regra do RS. Bases antigas sem base oficial conservam a classificação da evidência operacional. Somente atividades da programação entram, não imediatas cadastradas separadamente.

O recorte respeita o centro e IARI/ROTINA, a semana única ou até 12 semanas selecionadas. A consulta pagina 50 tarefas. Ausência de carga SAP não vira zero apropriação: aparece uma advertência para as semanas que não podem ser conferidas. Centros fora do RS só aparecem quando o usuário os torna visíveis na tabela já existente.

Versões fechadas usam os itens, justificativas e linhas SAP preservados no próprio fechamento. O servidor valida o vínculo fechamento/semana e não retorna dados atuais como substituto de memória histórica ausente. As autorizações de RS e obra permanecem inalteradas. Nenhuma função de cálculo, tarefa, perfil, carga ou fechamento é atualizada pela consulta.

Verificação: testes transacionais do caso real e de arquivos fictícios revertidos com ROLLBACK. Cobertura de apropriação positiva parcial, falta de justificativa, autor preservado, executada sem SAP, paginação, vários períodos, IARI/ROTINA, ausência de carga, fechamento incompatível, duplicidade de semana e negação ao perfil Operação. Os quadros de evidências removidos anteriormente continuam removidos.
# HH das tarefas sem apropriação

A coluna HH programado mostra `planned_hh` da evidência de cada tarefa/dia (viva ou preservada no fechamento), não o HH inteiro da base oficial RS por confirmação. O rodapé usa `totalPlannedHh` calculado sobre todas as pendências antes de `LIMIT/OFFSET`; com paginação, apresenta também o subtotal da página. Não multiplica o total da confirmação por suas tarefas. Campo ausente/inválido aparece como —; se houver HH desconhecido, o total completo fica indisponível. Semanas sem SAP continuam explicitamente excluídas como recorte parcial. Nenhum cálculo de RS ou registro operacional foi alterado.
