# Hora Extra mais rápido e com filtro de data por período

## O que está acontecendo hoje

A tela carrega **todas as solicitações já registradas** (hoje 1.279 registros, de 28/07 a 23/08) de uma vez, com todas as colunas, e faz tudo — filtros, KPIs, tabela — na memória do navegador. O filtro de data é uma lista montada a partir dessas linhas, então ele mostra todas as datas existentes (26 hoje) e vai crescendo indefinidamente a cada semana. Ou seja: quanto mais histórico, mais lento fica, e mais poluído fica o seletor de datas.

Os índices do banco já estão corretos; o peso está no volume trazido para a tela.

## O que vamos fazer

### 1. Filtro de data por período (em vez de lista de todas as datas)
- Substituir o seletor "todas as datas" por um filtro de **período**: atalhos rápidos (Hoje, Ontem, Últimos 7 dias, Este mês) mais um intervalo De/Até.
- Padrão ao abrir: **últimos 30 dias**.
- Dentro do período escolhido, um seletor de dia específico continua disponível, mas listando só as datas daquele período.
- Botão "Limpar período" para quem realmente precisa consultar histórico antigo.

### 2. Carregar só o período selecionado
- As consultas de Minhas solicitações, Aprovações, Exportação diária e Transportes passam a filtrar por data **no banco**, trazendo apenas o intervalo ativo em vez de toda a tabela.
- Trocar o `select("*")` das funções de exportação pela lista exata de colunas usadas, reduzindo o tamanho da resposta.

### 3. Tabelas mais leves
- Paginação nas tabelas de Aprovações, Minhas solicitações e Exportação diária (mesmo padrão já usado em Atividades), evitando renderizar centenas de linhas de uma vez.
- Manter o "Exportar para Excel" gerando o arquivo com **todas** as linhas do período filtrado, sem depender do que está na página visível.

### 4. Menos recarregamentos
- Cada aba busca apenas seus próprios dados, com cache por período (aba + intervalo na chave de cache), evitando refazer a consulta ao trocar de aba e voltar.

## Detalhes técnicos

- `src/lib/overtime.functions.ts`: adicionar `from`/`to` (datas ISO) ao input de `listOvertimeForExport` e `listApprovedTransportRows`, aplicar `.gte("overtime_date", from).lte("overtime_date", to)`, e trocar `select("*")` por colunas explícitas.
- `src/routes/_authenticated/hora-extra.tsx`: novo estado de período compartilhado no topo do módulo; `queryKey` inclui `[tab, from, to]`; consulta Supabase da aba lista/fila com filtro de data; componente `PeriodFilter` reutilizado nas abas; paginação local (50 linhas/página) nas tabelas.
- KPIs continuam derivados do conjunto filtrado atual (período + demais filtros).
- Sem alteração de schema; os índices `overtime_requests_date_idx` e `idx_overtime_date_times_status` já cobrem os novos filtros.
