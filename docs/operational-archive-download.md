# Download paginado dos arquivos históricos operacionais

Problema verificado no arquivo preparado 193c0ec9-eb4e-4246-9b8a-4d3c532ac4de: 6.281 registros (4.641 HE e 1.640 mudanças), 7,20 MiB de payload bruto e 1.554 batch IDs. O caminho antigo concentrava tudo numa resposta e numa única consulta IN de lotes. O erro 520 foi reportado pelo usuário; não foi atribuído a um limite específico do provedor sem evidência.

A nova função loadOperationalArchivePage entrega até 200 linhas por chamada, ordenadas por record_date e id. A consulta dos lotes é fragmentada em até 50 IDs, com filtro de obra. Mantém os mesmos campos de enriquecimento e os controles de administrador/obra. Não usa escrita, exclusão ou finalização. O nome novo evita que um cliente antigo interprete a primeira página como um arquivo completo.

O navegador acumula páginas sequencialmente, mostra progresso e confere identidade do arquivo, prepared_at, quantidades totais/por tipo, IDs únicos e avanço da paginação. O Excel só é criado depois da coleta integral. Se qualquer bloco falhar ou não conferir, não é gerado arquivo parcial nem liberado Finalizar. Uma nova tentativa começa do início; o arquivo salvo permanece intacto. A geração mantém as abas e o mapeamento de campos existentes, inclusive pendentes.

Baixar Excel usa btn-primary como Finalizar. As ações concorrentes do painel ficam bloqueadas durante a operação. A finalização continua manual, após download e conferência, e não foi executada nesta alteração.

Validação: testes puros em tests/operational-archive-download.test.mjs cobrem 6.281 linhas em 32 páginas, 1.554 lotes em 32 grupos de até 50, preservação de payloads, falhas, duplicatas e contagem por tipo. Consulta SQL somente leitura confirmou o volume do arquivo real e os limites por página. A verificação ponta a ponta autenticada no navegador não foi executada nesta sessão.
