# Aprovação e troca de perfis em transação única

Correção gradual autorizada pelo usuário após a investigação do fluxo não atômico.

## Alteração

Migration 20261123180000_atomic_user_approval.sql cria a operação fixa set_nexo_user_approval(uuid,text,text[]). O ator vem exclusivamente de auth.uid(). A função exige liberação de senha, ator aprovado, administrador geral pelo helper existente ou administrador local e associação do alvo à obra selecionada do ator. Somente o administrador geral pode atribuir admin, como no fluxo anterior. Não foram ampliadas as regras de obra/perfis.

Status e roles são validados antes de qualquer escrita, incluindo lista vazia/nula, duplicatas, nomes inválidos e limites. Roles nulos mantêm perfis existentes. Aprovar sem roles novos exige ao menos um perfil já cadastrado. Status/approved_by/approved_at e substituição dos roles ocorrem na mesma transação. Locks de perfis são adquiridos em ordem estável, com espera limitada a dois segundos. Não há tratamento de exceção que engula erro depois de alteração parcial. A função não usa SQL dinâmico ou role de serviço e não recebe ator por parâmetro. Execute anônimo/public revogado, authenticated permitido com os guardas internos.

setUserApproval no aplicativo deixa de fazer UPDATE/DELETE/INSERT separados com service client. Faz apenas essa RPC com o JWT do chamador e limite de 15 segundos. Resultado ambíguo ou resposta inválida não vira sucesso e não é reenviado automaticamente. A tela existente e suas regras de formulário permanecem.

## Banco e preservação

A candidata foi validada em transação com rollback e alvos/sites sintéticos. Teste de administrador geral utiliza somente sua autoridade existente para modificar alvo sintético, não seu cadastro. Foi forçada exceção exatamente entre DELETE e INSERT: profile completo e linhas originais de user_roles permaneceram idênticos após rollback da tentativa.

Cobertura SQL: sucesso, deduplicação, status sem troca de roles, escopo local, concessão indevida de admin, alvo de outra obra, roles vazios/inválidos/nulos, aprovação sem perfil, usuário comum, ator bloqueado, anonimato, password gate e autoridade global legítima. Um fixture preliminar de reset omitiu ator de auditoria e foi rejeitado corretamente por NOT NULL; a transação foi revertida, o fixture corrigido e o teste completo passou. Nenhum reset real foi realizado.

A migration foi instalada sem executar a função em cadastro real. Hashes de profiles e user_roles antes/depois confirmaram preservação dos registros no rollout. Verificação independente após aplicação: zero contas/sites/auditorias sintéticos persistentes, zero aprovados sem roles, execute anônimo negado e authenticated permitido.

## Verificação

278 testes Node, 20 testes Bun selecionados de diretório/reset/identidade aprovados, TypeScript sem erros e build de produção concluído. Testes do handler cobrem operação única caller-scoped, roles nulos, negações, payload inválido e resposta perdida sem retry.

O banco está preparado. A versão nova do handler ainda não foi publicada neste lote: a versão em produção continua usando o caminho anterior até a publicação. Hora extra manual e operações em série de mudança de escala não foram modificadas. Esta correção de consistência administrativa não demonstra a causa das desconexões WebSocket.
