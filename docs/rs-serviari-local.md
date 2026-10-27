# SERVIARI sempre IARI no RS

Regra confirmada pelo responsável: SERVIARI pertence sempre a IARI. Não inferir ROTINA pela confirmação de uma tarefa programada em outro centro.

A migração 0031 aplica um resolvedor restrito a SERVIARI nos caminhos de evidência operacional, apropriação legada, programação oficial e SAP oficial. Todos os demais centros preservam a precedência anterior. As validações de disponibilidade no cliente e servidor rejeitam SERVIARI em outro local, sem preencher horas fictícias. Novos fechamentos registram a regra v4; fechamentos já preservados não são regravados. Atividades, status, PTs, fontes SAP e disponibilidade existente não são modificados.

Caso verificado da semana 40: confirmação 0135870428, ordem 2031637667, operação 0010/suboperação 0010, SAP SERVIARI 8,8 HH; programação SERVENTE/ROTINA. Antes, a composição produzia SERVIARI/ROTINA sem disponibilidade. Depois, os mesmos 8,8 HH ficam em SERVIARI/IARI, onde há 308 HH disponíveis. Totais gerais apropriados permanecem iguais. Nenhuma dupla contagem é introduzida.

Validação em transação com ROLLBACK: migração aplicada duas vezes (idempotência), comparação de todos os centros nas semanas 40 a 44 e nos três recortes, preservação dos demais centros, preservação dos HH totais no geral e eliminação do vínculo SERVIARI/ROTINA na semana 40. Semanas 41 a 44 não tiveram mudança nos centros calculados. Testes do cliente em `tests/rs-serviari-local.test.mjs`.
