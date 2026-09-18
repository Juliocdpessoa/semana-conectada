# Corrigir seletor de semana para Operação

## Objetivo
Garantir que todos os usuários autorizados vejam e consigam selecionar a semana em preparação na tela de Atividades, sem depender de uma verificação de perfil apenas na interface.

## Alterações
- Carregar as semanas disponíveis para todos os usuários autenticados e deixar as permissões do banco definirem quais semanas cada perfil pode visualizar.
- Exibir o seletor sempre que houver semanas disponíveis; usuários sem acesso à preparação continuarão recebendo apenas as semanas permitidas.
- Separar o cache da lista de semanas por usuário e obra, evitando reaproveitamento incorreto ao trocar de conta.
- Validar no preview e conferir os erros de execução e compilação.

## Resultado esperado
Todos os perfis Operação aprovados da obra verão a semana operacional e a semana em preparação no seletor, com o mesmo comportamento observado para João.
