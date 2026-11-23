# Diagnóstico seguro de fechamento realtime

Implementação local em 23/11/2026, ainda não publicada e migração ainda não aplicada em produção.

- Extrai somente código inteiro entre 1000 e 4999 de CloseEvent, Error.cause ou prefixo exato normalizado pelo SDK fixado. Nunca envia reason livre, causa, URL ou payload.
- Propaga o campo opcional closeCode nas duas telas de atividades, erro diagnóstico, fila limitada, transporte HTTP fixo, validação estrita e metadado realtime_close_code no registro aceito.
- Compatível com diagnósticos antigos sem campo; códigos fora do intervalo, texto e códigos em eventos não realtime são rejeitados.
- Mantém duas falhas por página, intervalo mínimo de cinco minutos, limites e prazos existentes. Não muda assinatura, sessão, permissões, tokens, reconexão, tarefas ou interface.

Validação: 282 testes Node passaram, nove testes Bun do coletor passaram, TypeScript sem erros e build de produção concluído. Os códigos sintéticos nos testes não são códigos observados em produção.

## Publicação futura

Aplicar primeiro supabase/migrations/20261123200000_realtime_close_code_diagnostics.sql, que apenas adiciona coluna opcional com CHECK, sem atualização dos registros antigos. Depois publicar aplicação e confirmar versão e rota do coletor. A validação nova não pode ser testada contra coletor antigo como se já estivesse publicada.

O campo melhora a evidência mas não determina sozinho causa raiz; código 1006, em particular, indica fechamento anormal observado pelo navegador, não prova bloqueio por proxy ou falha do servidor. Eventos antigos não podem ter código recuperado retroativamente. Nenhuma confirmação de resolução das quedas é alegada por esta instrumentação.
