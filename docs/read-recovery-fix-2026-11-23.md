# Recuperação de leituras e reconciliação

Correção autorizada após a investigação de 23/11. Sem migração, edição de dados operacionais, mudança de cálculos, redefinição de contas ou IA da Lovable.

## Reconciliação

A falha de uma sonda de revisão não impede mais a leitura autorizada da lista. Nessa situação, tentativas integrais degradadas ficam limitadas a uma por minuto por instância, mantendo recuo e execução serial. Abas ocultas/offline e instâncias descartadas não iniciam leituras. A revisão pendente é limpa antes de cada sonda, para uma leitura degradada não certificar um marcador antigo. Falha de leitura continua sendo falha; nenhuma revisão nova é inventada.

## Transporte

Somente leituras já allowlisted como read-data/rpc-read ganham prazo de 25 segundos, cobrindo fetch e leitura integral do corpo. Mantém limite de resposta existente por operação, cancelamento do chamador, status/cabeçalhos de autorização e uma tentativa por chamada. Não adiciona RPC nem permissão. Em timeout de leitura direta, a preferência de relay é marcada para a próxima chamada, sem repetir a mesma solicitação. Cancelar uma consulta por troca de filtro não marca a rota como defeituosa.

O helper cancela o pedido/stream e não apenas abandona uma Promise. Dados de resposta são limitados antes de concatenar. Cabeçalhos de comprimento/compressão são removidos ao reconstruir um corpo já descomprimido. Operações de escrita e autenticação mantêm caminhos e proteção contra repetição existentes. Arquivos gerados de autenticação permanecem intactos.

O prazo começa no fetch operacional, não antes da aquisição de token do SDK. Isso não resolve nem comprova a origem de falhas WebSocket. A renovação de tokens continua responsabilidade do SDK; sockets saudáveis não são reiniciados e writes nunca são reproduzidos pela recuperação.

## Verificação

264 testes Node aprovados. 49 testes de transporte e 14 testes de identidade/realtime/telemetria aprovados com o SDK isolado da versão de produção (2.110.7). Novos casos cobrem sonda defeituosa com canal saudável/desconectado, cooldown de falha, descarte/visibilidade, headers pendentes, corpo pendente, cancelamento do chamador, limites de bytes, preservação de resposta 403/204, ausência de retry e ausência de mudança em writes.

TypeScript sem erros e build de produção concluído. Publicação não iniciada nesta etapa. Não houve validação autenticada de dois usuários na rede Petrobras.
