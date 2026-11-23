# NEXO — investigação de quedas e inconsistências de acesso

Revisão de 23/11/2026, captura principal às 08:35:54 de Brasília. Consultas complementares até aproximadamente 08:40. Código local `2b5d097`; árvore correspondente publicada em `acb26b72d04ffc73e9265101c4fecb75560c018e`, deployment `c40334ac-2541-4240-97c6-4f9302a41999`, cuja confirmação nos dois domínios ocorreu na correção anterior. Esta varredura não iniciou outra publicação e não modificou código funcional, contas, tarefas ou regras de negócio.

## Conclusão

Não há evidência de uma única causa para todos os relatos. Há falhas de carregamento/renovação de sessão, desconexões reais do canal de atualização e lacunas de sincronização de telas que podem parecer indisponibilidade ou dados atrasados. Os dados disponíveis não sustentam atribuir todas as falhas à rede Petrobras, ao volume de usuários ou ao backup.

A contradição entre o prazo da tela e o prazo do SDK, junto à tentativa inicial direta de autenticação, é um defeito confirmado do fluxo anterior, corrigido na publicação desta manhã. O retorno informado pelos usuários é evidência prática favorável, mas não prova que toda desconexão remanescente tenha a mesma origem.

## Dados desde sábado, 21/11

Fonte: tabelas de diagnóstico e amostras do próprio aplicativo. Janela inicia em 21/11 00:00 Brasília; segunda-feira é parcial.

| Registros recebidos | Quantidade |
| --- | ---: |
| Todos os diagnósticos | 123 |
| Tempo real | 71 |
| Consulta/carregamento da sessão | 38 |
| Demais etapas de acesso | 14 |
| Registros sem identidade vinculada | 33 |
| Usuários identificados distintos | 34 |
| IDs de cliente distintos | 53 |

Os 123 IDs de evento são únicos. IDs de cliente vêm de sessionStorage: não equivalem a computadores ou pessoas únicas. Os diagnósticos podem repetir falhas de uma mesma aba. Estes números não são quantidade de quedas completas nem percentual de disponibilidade.

Dos 71 diagnósticos de tempo real, 70 têm classificação genérica de transporte e um indica JWT. A classificação genérica não distingue proxy, firewall, serviço remoto, suspensão de aba ou ruptura de conexão. Há eventos identificados no grupo Prestserv informado pelo usuário, mas também fora dele. Falta o denominador de uso por rede; não é válido calcular a taxa de falha da Petrobras com estes registros.

As 300 amostras de consultas de Atividades desde sábado não registraram falha. Hoje, nas 128 amostras com filtros, o P95 foi 781 ms e o maior tempo 5.425 ms; nas 20 amostras sem filtros, P95 de 736 ms. São amostras de quem chegou à consulta, não garantia para quem ficou impedido de entrar nem medição do tempo de renderização.

Há cinco eventos de recuperação do canal: 24,016 s no domingo; 3,064 s, 48,692 s, 173,032 s e 83,366 s na segunda. Medem falha observada até SUBSCRIBED e podem incluir aba suspensa/em segundo plano. Não medem entrega de uma alteração de tarefa. Conexões, desconexões e recuperações são eventos com limites de coleta diferentes; não devem ser divididos entre si para obter disponibilidade.

## Linha do tempo e causas confirmadas

1. **18–19/11, conflitos de edição de PT:** a revisão histórica já identificou uso indevido de SQLSTATE `40001` em conflitos funcionais. Isso podia provocar repetição de transações no PostgREST. A revisão atual confirmou as cinco funções de conflito com `PT409` e nenhuma com o `40001` antigo. Não há evidência de reintrodução. Migrações antigas preservam o histórico; não representam o corpo vigente das funções.
2. **19–20/11, sessão e transporte:** já há diagnósticos recebidos em 19/11 e falhas de rede/tempo real em 20/11. A coleta começou nessa fase; ela não permite afirmar que nunca houve falhas antes. Foram corrigidos HTTP 204 de logout, reenvio de refresh incerto e recargas por foco da aba. Não houve troca comprovada da assinatura de WebSocket nos dois commits originais da correção de PT.
3. **21/11, recuperação do tempo real:** foram adicionados sondagem de revisão e eventos de saúde. A conexão continua dependente de WebSocket direto; as leituras alternativas usam a rota autenticada do próprio NEXO. Isso é recuperação parcial de dados, não restauração garantida de WebSocket na estação.
4. **23/11, carregamento de sessão:** foram corrigidos prazo de 8 segundos incompatível com ciclo de refresh do SDK, ausência de limite de rede em chamadas de autenticação e consultas sobrepostas. A autenticação agora inicia pela rota fixa do NEXO; o SDK mantém sua rotação e proteção contra reenvio incerto. Não houve reset de contas como correção.

## Novos achados e riscos ainda abertos

### A. O diagnóstico depende do mesmo fluxo de sessão que pode falhar — prioridade alta

`src/start.ts` registra globalmente `attachSupabaseAuth`. Esse middleware gerado em `src/integrations/supabase/auth-attacher.ts` executa `getSession()` antes de qualquer server function. O coletor central usa uma server function e, portanto, também passa por essa etapa, inclusive durante falhas de acesso.

No coletor cliente, uma corrida de seis segundos limita a espera, mas não cancela a operação subjacente; há novas tentativas limitadas. A fila persiste no máximo cinco itens por aba durante um dia e o servidor só recebe horário de recebimento. Portanto, o diagnóstico pode chegar tarde ou não chegar, e uma consulta vazia por usuário não prova que o acesso funcionou.

**Recomendação:** tornar a coleta de acesso independente de consulta/refresh de sessão no cliente, mantendo identidade opcional verificada no servidor e os limites de coleta. Registrar horário de ocorrência validado, horário de recebimento e versão real da aplicação. Não enviar tokens, IPs, payloads de tarefas ou mensagens brutas.

### B. Verificações de acesso no servidor sem prazo próprio e mensagem enganosa — prioridade alta

`src/lib/password-auth.ts` chama `password_reset_state` sem abortSignal/prazo próprio. Qualquer erro da RPC cai na mesma mensagem de senha a redefinir. Uma falha transitória de rede não comprova necessidade de reset, mas é apresentada como se comprovasse.

O middleware gerado de identidade também não estabelece prazo explícito para chamadas de verificação de claims/JWKS quando precisarem de rede. Os prazos nos handlers de dados iniciam depois dos middlewares. Um prazo de seis segundos no cliente de sondagem não limita automaticamente todo o trabalho anterior no servidor.

**Recomendação:** aplicar orçamento e cancelamento ao fluxo completo de autenticação/verificação no servidor, sem modificar o cliente gerado nem dispensar verificação de identidade, senha, aprovação ou RLS. Separar indisponibilidade de validação de acesso negado; nunca transformar falha de rede em ordem de reset.

### C. Sincronização incompleta das listas — prioridade média/alta para colaboração

- Em `src/routes/_authenticated/atividades.tsx`, o único canal Postgres escuta UPDATE de `activities`, filtrado pela semana. Não escuta INSERT e DELETE. Com canal saudável, a sondagem alternativa para. Uma inclusão/exclusão de tarefa não garante atualização imediata da lista de outro usuário.
- Em `src/components/continuous-activities.tsx`, a Fiocruz usa consultas paginadas de 50 linhas e invalidação local ao salvar, mas não há assinatura realtime nem refetchInterval. As alterações remotas dependem de refetch normal/foco ou atualização pelo usuário.
- Na RPBC, durante falha de canal, a sondagem ocorre a cada 10–15 segundos; releituras pesadas têm intervalo mínimo de 20 segundos e reconciliação periódica de 60 segundos. Se a sondagem falha, há backoff. Esses tempos não equivalem a colaboração instantânea.

**Recomendação:** completar a cobertura de eventos e telas de forma limitada por obra/semana, incluindo consistência de novas linhas e exclusões. Medir atraso real de revisão/atualização da lista, visibilidade e estado offline sem sobrescrever rascunhos ou reenviar gravações. Não aumentar polling global indiscriminadamente.

### D. Consultas secundárias lentas existem, mas não são prova da causa do login — prioridade média

`pg_stat_statements` acumula desde 18/11 às 13:47:45 de Brasília. A consulta de linhas SAP identificada teve média de 1.972 ms e máximo de 7.993 ms; a leitura de colaboradores identificada teve média de 1.106 ms e máximo de 7.725 ms. A consulta principal de atividades teve média de 447 ms e máximo de 3.929 ms. Estes máximos não estão datados por execução e não podem ser atribuídos ao incidente de segunda-feira.

**Recomendação:** capturar duração por operação/obra e orçamento de consultas auxiliares; revisar paginação, seletividade e índices antes de aumentar infraestrutura. Não fazer criação de índices pesada ou teste de carga durante uso normal sem planejamento.

### E. A coleta não identifica precisamente a versão nem a duração da falha — prioridade alta para investigação

O valor de build v2 identifica o formato da telemetria desde 20/11, não cada publicação. Três registros recebidos desde sábado ainda usam v1; podem ser fila atrasada ou cliente antigo, não prova automática de cache desatualizado.

Faltam horário de ocorrência no servidor, versão real do app, visibilidade da aba, caminho direto/relay e confirmação de revisão de dados. Esses campos são necessários para diferenciar publicação antiga, falha de autenticação, desconexão, aba suspensa e atraso na entrega.

## O que a checagem não apontou como causa atual

- Snapshot do banco: zero espera por lock e zero consulta ativa de API acima de cinco segundos. É um instante, não histórico de disponibilidade.
- Dois slots de replicação ativos, diferença de WAL de 0/-1 byte; a diferença negativa mínima resulta de leituras concorrentes. `activities` continua na publicação `supabase_realtime`.
- Backup: 3.399 execuções do worker consultadas desde sábado, maior duração de 0,06 s. A fila tinha quatro capturas cadastradas, zero pendentes e zero pendentes com erro. São execuções do worker, muitas sem trabalho, não 3.399 backups produzidos. O máximo histórico de 120,9 s visto em pg_stat_statements é anterior ou fora do recorte recente verificado; não explica por si estas quedas. Não foi feita verificação de integridade/restauração de arquivos nesta auditoria.
- Não há diagnóstico com stage runtime no recorte desde sábado; isso não exclui falha de carregamento anterior à inicialização da telemetria.
- Não há registro classificado de quota/replicação no recorte. Coleta limitada e classificação genérica não permitem excluir completamente essas causas.

## Próxima ordem de trabalho

1. Fechar as lacunas de prazo/cancelamento e classificação dos erros no acesso do servidor.
2. Desacoplar e melhorar a telemetria para comparar versões e ocorrência/recebimento sem coletar dados sensíveis.
3. Completar sincronização de inclusões/exclusões e da tela contínua; manter limites por obra, semana e aba visível.
4. Medir propagação de uma alteração autorizada entre duas sessões reais na rede Petrobras e outra rede, sem fabricar histórico em tarefas de produção.
5. Otimizar as leituras secundárias identificadas com medição por operação; dimensionar só quando houver evidência de pressão sustentada.

## Validação e fontes

Nesta varredura foram reexecutados 25 testes de sessão, diagnóstico, recuperação e regras de consulta, sem falha. Não houve teste de carga, login com senha de colaborador, alteração de dados, nova publicação ou teste físico na rede Petrobras. Nenhuma IA da Lovable foi usada.

Consultas reproduzíveis: `docs/reliability-sweep-2026-11-23.sql`. Agregados retornados: `docs/reliability-sweep-2026-11-23.evidence.json`. Código e migrações citados acima; histórico anterior em `docs/code-audit-2026-11-20.md`, `docs/realtime-investigation-2026-11-20.md`, `docs/realtime-recovery-2026-11-21.md` e `docs/access-session-incident-2026-11-23.md`.
