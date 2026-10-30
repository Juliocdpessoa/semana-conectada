# Redefinição de senha administrativa

Em Administração → Usuários, um administrador autorizado confirma **Resetar senha**. O Auth Admin API substitui a senha por 123456 e grava a obrigação de troca em app_metadata protegido. Não há senhas em tabelas públicas nem na auditoria.

A senha temporária vale por 24 horas. Login aceita a temporária de seis caracteres; cadastro e senha definitiva continuam exigindo oito. O usuário é direcionado para /redefinir-senha e só pode acessar os módulos após escolher uma senha pessoal. A recuperação por e-mail existente permanece disponível.

Proteção no servidor: middleware de todos os handlers de negócio, políticas RLS restritivas com init-plan e helpers de permissão para RPCs SECURITY DEFINER. Sessões anteriores ao reset não recuperam acesso após a troca. O navegador não pode remover a obrigação via user_metadata. O trigger rejeita conclusão de uma versão antiga do reset e conclusão sem mudança real da senha.

Administrador de obra só pode resetar contas aprovadas da própria obra. Contas com perfil admin ou vinculadas a outras obras exigem o administrador geral. Não há reset da própria conta, aprovação nem desbloqueio implícito. Repetições em menos de um minuto são recusadas. Confirmação mostra nome, prazo e orientação de comunicar a senha por canal seguro.

Auditoria imutável para usuários autenticados: solicitação (quem/quando) e conclusão. A página de usuários mostra o último evento. A tabela não faz parte dos backups operacionais SAP/RS.

Validação: testes de autorização e schema, compilação TypeScript, build cliente/servidor e testes transacionais no PostgreSQL com contas fictícias e ROLLBACK. Nenhuma senha real deve ser resetada durante testes. O funcionamento ponta a ponta do Auth Admin API deve ser conferido no preview com conta de teste antes da publicação.
