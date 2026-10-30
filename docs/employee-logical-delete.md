# Exclusão de colaboradores com histórico

Excluir do cadastro agora marca `employees.deleted_at`, desativa o cadastro e registra o responsável nos campos `updated_by_user_id`/`updated_by_name`. Não há DELETE no servidor. IDs, nomes, solicitações, aprovações, arquivos e chaves estrangeiras históricos permanecem existentes.

A lista de cadastro (inclusive exportação dessa lista) ignora os excluídos. Seletores de novas solicitações já exigem `is_active=true`. A restrição de banco impede um registro excluído de ficar ativo. Edição e reativação comum exigem `deleted_at IS NULL`. Perfis aprovados de gerente, logística e administrador e filtro de obra continuam obrigatórios no servidor.

A importação explícita da mesma chapa reutiliza o cadastro via upsert, remove a marca de exclusão e reativa o mesmo ID, preservando seus vínculos. A confirmação da exclusão informa essa possibilidade. A listagem histórica não recebe filtros de exclusão do cadastro.

Migração 0032 é aditiva e não exclui nenhum colaborador existente. Validada em transação com ROLLBACK usando colaborador fictício e tabela de referência: vínculo mantido, fora da lista corrente e inativo para novas solicitações. Nenhum colaborador real foi excluído no teste. Testes estáticos em `tests/employee-logical-delete.test.mjs` cobrem permissões, escopo de obra, ausência de DELETE e mensagens.
