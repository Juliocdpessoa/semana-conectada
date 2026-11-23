# Correções incrementais de confirmação e atualização

Lote autorizado pelo usuário para corrigir gradualmente as falhas verificadas, sem alteração de dados operacionais, cálculos RS ou uso da IA da Lovable.

## Confirmação de status RPBC

Após a resposta bem-sucedida da RPC canônica bulk_update_activity_reports_v2, updateActivity agora devolve confirmação de sucesso sem uma segunda consulta de readback. Antes, essa segunda requisição podia falhar após o commit e transformar um write confirmado em erro na interface. O único consumidor usa ok e invalida suas consultas, sem consumir o snapshot updated removido.

Validação de acesso, justificativas, vínculos, versão e transação canônica permanecem. Erro da RPC continua erro. Conflito explícito continua no caminho de leitura do estado atual. Resposta perdida/exception não vira sucesso nem retry de write. Nenhum snapshot/versão é fabricado para fingir confirmação. Nenhuma função SQL foi alterada.

## Atualização Fiocruz

O refresh de lista, opções e cartões permanece obra/usuário filtrado e usa apenas consultas ativas. Um coordenador serial aguarda leituras em andamento e faz uma nova leitura para não aceitar resposta capturada antes do evento. Eventos recebidos durante a consulta são agrupados em uma única indicação de catch-up.

No máximo duas passagens imediatas por execução; demanda adicional é diferida em dois segundos. Descarte e aba oculta/offline impedem novas leituras. O coordenador não cancela queries em andamento, não limpa filtros/rascunhos, não reenvia mutações e não reinicia sockets. Falhas de leitura continuam propagando ao fallback existente, sem confirmação falsa de atualização. A reconciliação periódica e as inscrições filtradas permanecem.

## Verificação e limites

Testes executam o corpo real do handler de status com fixtures em memória, incluindo sucesso sem readback, rejeição, conflito e resposta perdida. Teste de integração com QueryClient/QueryObserver reproduz estado capturado 1, servidor atualizado a 2 e valida exibição final 2 com duas leituras seriais. Também cobrem agrupamento de eventos, descarte/visibilidade, erro e catch-up diferido. Nenhum usuário ou dado real foi usado como fixture.

Não foi ampliada a rota alternativa para writes. Gravações diretas Fiocruz e observabilidade de códigos/eventos system do realtime seguem como próximos itens de investigação/correção, não foram silenciosamente incluídos neste lote. Estes ajustes não demonstram nem resolvem por si sós a origem dos encerramentos WebSocket da rede Petrobras.

TypeScript sem erros e compilação de produção concluída. 21 testes Bun adicionais (identidade, realtime, telemetria e transporte RS) aprovados com SDK isolado de produção 2.110.7. O teste de integração não comprova entrega autenticada na rede Petrobras. Publicação não iniciada neste lote.
