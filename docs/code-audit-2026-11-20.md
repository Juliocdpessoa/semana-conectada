# Revisão direta do código — 20/11/2026

Base: `206571e8879b64168c5b075a5a867523ac7fd75b`. Revisão local, sem IA da Lovable e sem gravações no banco de produção.

## Falhas corrigidas

1. **Renovação de sessão:** `Failed to fetch` não comprova que o servidor deixou de processar a chamada. A proteção contra reenvio agora também cobre a perda da resposta direta de refresh. A sessão permanece armazenada; uma resposta incerta não autoriza entrada nem reutilização do mesmo token rotativo. Uma nova autenticação pode ser necessária se a resposta do refresh tiver sido perdida.
2. **Saída da conta:** HTTP 204 legítimo era reconstruído com corpo vazio, proibido pelo Fetch, e virava 502. Respostas sem corpo são preservadas.
3. **Cache e foco:** `SIGNED_IN` pode representar retorno à aba, não uma nova identidade. Não recarregamos todas as consultas nesse caso. Saída e troca de identidade cancelam consultas e limpam o cache. O trabalho fica fora do callback síncrono do SDK.
4. **Leitura SAP em Atividades:** adicionada paginação explícita das linhas importadas, sem limitar o resultado à primeira página. Troca de semana cancela as páginas pendentes.
5. **Picos de carregamento:** a leitura auxiliar de todas as páginas de atividades para alocação SAP passa a executar no máximo duas páginas simultâneas, com cancelamento.
6. **Repetições de consultas:** política padrão limitada a uma repetição, sem repetir HTTP 4xx, limites de taxa, conflitos de negócio ou erros estruturais conhecidos. Políticas explícitas de consultas individuais continuam prevalecendo. Mutações não recebem repetição automática.
7. **Tela de recuperação:** falhas dos hooks opcionais de telemetria não derrubam a tela nem impedem o diagnóstico central. A mensagem distingue falha de rede de tempo esgotado.
8. **Redefinição de senha:** inicialização com prazo e tratamento de falhas, em vez de promessa sem tratamento ou espera indefinida. Regras de senha e autorização não foram relaxadas.

## Verificação

- Testes Node das regras de negócio, importações, RS, PT/LIBRA, disponibilidade, filtros, arquivos, rascunhos e novas regressões.
- Testes Bun do transporte com SDK real e respostas simuladas, permissões de reset, PBS e repetição de rede.
- TypeScript `--noEmit` e build de produção.
- Três testes antigos foram atualizados para contratos já vigentes: patch explícito de LIBRA em vez de reenvio completo e teto por especialidade em vez de teto independente por centro. Não houve mudança do cálculo de RS para fazê-los passar.

## Limites e pendências

- Passar nos testes não comprova a causa externa da falha de conexão nem garante ausência de outros defeitos. Não houve teste de carga com 170 usuários nem login usando credenciais dos colaboradores.
- O relay continua restrito às operações já listadas. Escritas, importações, outras telas e WebSocket/realtime não se tornam automaticamente independentes da conexão direta. Não prometer recuperação completa em uma rede que bloqueie o backend inteiro.
- Um token de refresh cujo resultado é incerto fica protegido contra reenvio nesta página; isso evita rotação duplicada, mas não recupera uma resposta perdida. O usuário pode precisar autenticar-se novamente.
- O limite de tentativas do serviço de autenticação pode agregar endereços da hospedagem ao usar o relay. HTTP 429 e `retry-after` permanecem preservados; infraestrutura/limites não foram alterados.
- O build local usa dependências resolvidas por npm, pois a instalação Bun falhou no diretório temporário e pnpm não pôde criar seu link de store. O `bun.lock` original não foi alterado. A construção no ambiente publicado ainda deve ser confirmada.
- A auditoria automatizada de vulnerabilidades npm não foi concluída: o projeto versiona `bun.lock`, não `package-lock.json`. Nenhuma atualização indiscriminada de dependências foi aplicada.
- Nenhuma publicação foi iniciada nesta revisão.
