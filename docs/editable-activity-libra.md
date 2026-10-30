# LIBRA editável

LIBRA permanece em planning_data.LIBRA, entre Tipo de Liberação e Data. Participa da grade, edição individual, colar/arrastar e modal de preenchimento em lote. Limite de 120 caracteres; vazio limpa o valor. Somente Planejamento e Administrador editam. Operação mantém apenas suas permissões anteriores de PT/status; Consulta não ganha edição.

O endpoint existente recebe libra opcional para compatibilidade: clientes antigos que omitem o campo não o apagam. A função de banco preserva bloqueio de linha e expected_version, restringe a obra, valida tamanho/tipo e recusa alteração de LIBRA por Operação. Somente a chave LIBRA é mesclada ao planning_data, junto à sincronização de data já existente; os demais campos são preservados.

Os triggers naturais recebem a chave libra na projeção de comparação e histórico. Assim a mudança atualiza responsável/data, versão e um único evento com valor anterior/novo. Nenhuma atividade ou histórico anterior é regravado pela migração 0033. O modal em lote envia versão esperada e mantém a cor da PT ao preencher as cinco colunas.

Validação em transações ROLLBACK: persistência/limpeza, responsável, um evento de histórico, conflito de versão, preservação de LIBRA em payload antigo, bloqueio de Operação/Consulta, permissão anterior de PT da Operação preservada e limite de tamanho. Nenhum apontamento real foi alterado pelo teste. Testes estáticos em tests/editable-libra.test.mjs e regressões da importação. Verificação visual autenticada não executada nesta sessão.
