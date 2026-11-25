# Filtros da evolução semanal do RS

Implementado localmente, não publicado. Novo filtro de especialidade, centros encadeados por especialidade, busca e seleção múltipla com o componente existente ContinuousMultiFilter, opção de limpar todos os filtros locais do gráfico. Alterar especialidade limpa centros incompatíveis. Mudança de obra/usuário limpa ambos; seleção ausente na página de semanas permanece explicitamente fora do recorte em vez de virar Todos silenciosamente.

Especialidade sem centros selecionados usa calculation.rows da própria semana, inclusive valores congelados. Centro único preserva seu rs; múltiplos centros combinam considered/available já fornecidos pela apuração, sem média dos percentuais, recálculo de teto ou mudança das regras contratuais. Exclusões includedInRs mantidas. Especialidade e centros sem base não viram barra zero. Sem filtros mantém resultado geral original.

Sem migração, escrita em dados, nova chamada ou inclusão dos filtros na queryKey: usa os relatórios já carregados e mantém doze semanas por página, cancelamento, lazy loading e cache de cinco minutos. Nenhuma modificação de outros filtros do RS.

Validação: 287 testes gerais Node passaram antes do teste de integração de wiring adicional; TypeScript sem erros. Testes cobrem congelado, zero, ausência de base, exclusões, normalização, seleção múltipla/deduplicação, combinação ponderada e não mutação dos dados. Compilação e teste de wiring conferidos separadamente ao concluir. Revisão visual em navegador autenticado não executada.
