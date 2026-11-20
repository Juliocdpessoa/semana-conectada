# Investigação da colaboração em tempo real — 20/11/2026

## Evidências

- `public.activities` permanece na publicação `supabase_realtime`.
- Os dois slots de replicação consultados estavam ativos, sem atraso acumulado (0/-1 bytes no instante medido; a diferença negativa mínima decorre de leitura concorrente dos contadores).
- Existiam duas inscrições autenticadas de atividades no instante consultado. Isso não representa o número total de usuários ativos nem prova que as demais estações estejam bloqueadas.
- Teste com duas conexões temporárias, canal aleatório e mensagem sintética: envio e recebimento em cerca de 0,3 s com o SDK **2.110.7**, que é o registrado em `bun.lock`. Sem leitura/alteração de tarefas, uso de contas reais ou credenciais administrativas. O teste também passou com o SDK local mais novo, mas essa não é a versão que sustenta a conclusão sobre a versão publicada.
- A simulação de remover e reinscrever o mesmo tópico não reproduziu reutilização indevida/dupla inscrição no SDK fixado. Não foi aplicada uma correção especulativa para esse caso.
- A comparação dos commits de 18–20/11 não mostra substituição da versão do Supabase SDK nem retirada do filtro/subscrição de atualizações em 19/11. Houve mudança no pacote de build e mudanças de sessão/recuperação; não foi demonstrado que sejam a causa do erro WebSocket observado na estação afetada.
- O incidente de 19/11 com repetição de transações pelo código SQLSTATE `40001` é um problema previamente comprovado e corrigido com `PT409`. Isso não prova que a falha atual de conexão tenha a mesma causa.

## Instrumentação restrita

O aviso visual não foi recolocado. Falhas do canal passam a registrar apenas etapa `realtime`, categoria fixa e motivo classificado: transporte, timeout, autorização, JWT, limite, replicação, encerramento ou desconhecido. A classificação não guarda mensagem bruta e não constitui prova de bloqueio corporativo.

Limites: até dois registros por página, espaçados em cinco minutos, além dos limites/retencão do coletor existente. Contexto do usuário é verificado no servidor; não vem de um ID declarado pelo cliente. Nenhum token, payload, conteúdo das tarefas, IP ou URL completa vai ao registro. Os clientes e registros v1 continuam aceitos; a nova versão é identificada por v2.

O ajuste de banco afeta somente a tabela/funções de diagnósticos. RLS, contas, tarefas, status e regras de RS não foram alterados. A migração foi validada em transação revertida antes de aplicada; o novo gravador continua exclusivo de `service_role`.

Callbacks de um canal já desmontado também são ignorados, para não iniciar consultas ou registrar falhas da semana antiga depois da troca de tela.

## O que ainda falta comprovar

O teste desta máquina não reproduz a rede da estação Petrobras que apresentou o aviso. Para estabelecer a causa dessa falha, é necessário receber os eventos classificados dos clientes novos ou obter evidência de conexão na estação afetada. Não é correto declarar o tempo real restaurado para todos com base apenas no teste sintético ou no fallback periódico.

As verificações de colaboração com dois usuários e uma tarefa real exigem um caso controlado, preservando a auditoria. Não foram alteradas tarefas reais para fabricar um evento de teste.
