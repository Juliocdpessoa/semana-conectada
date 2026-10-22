# Realização Semanal (RS)

## Regras confirmadas

- Disponibilidade total vem exclusivamente da tabela semanal por centro, data, local e especialidade. Ela já inclui toda a EEP; não há acréscimo de EEP nem referência automática de 4.708 HH.
- As datas e locais são detalhes da capacidade. O teto é semanal por especialidade, somando todos os centros e locais daquela especialidade antes de aplicar o limite.
- TCpr e TCoi usam HH efetivamente apropriado na última carga SAP detalhada vinculada à semana, não status EXECUTADO.
- TCpr considerado é limitado por confirmação normalizada na semana: `min(soma HH SAP programado, soma HH programado da confirmação)`. Confirmações em vários dias usam a soma semanal, não repetem o total SAP em cada tarefa. O limite é calculado antes de agrupar por especialidade e antes dos filtros de local; quando houver várias linhas SAP, o crédito limitado é distribuído proporcionalmente entre elas para não duplicar o teto. HH SAP bruto continua disponível na tela.
- HH considerado de cada especialidade = `min(TCpr limitado por confirmação + TCoi, HH disponível semanal)`. Imediatas mantêm HH SAP porque não têm programação correspondente. O excesso de uma confirmação não compensa outra.
- Se uma confirmação envolver centros elegíveis e centros fora do RS, os tetos são separados entre esses dois grupos; programação de acompanhamento não aumenta o crédito elegível.
- TP considerado da especialidade = `min(TP original, HH disponível)`; OM = `TP considerado / HH disponível`; RS = `HH executado considerado / TP considerado * OM * 100`, equivalente a `HH executado considerado / HH disponível * 100`. Usa o mesmo TP limitado no divisor e no OM, evitando dupla penalização da sobreprogramação.
- Geral: somar HH executados considerados após os tetos por especialidade; TP considerado geral = `min(TP original geral, disponibilidade geral)`; OM geral = `TP considerado geral / disponibilidade geral`; RS geral = `HH executado considerado geral / TP considerado geral * OM geral * 100`. Não fazer média dos percentuais nem das ocupações. O TP original fica preservado e aparece separado do TP considerado.
- Zero disponível é explícito: contribuição de HH considerada zero, RS da especialidade indefinido. Sem disponibilidade, SAP ou vínculo de centro não se fabrica resultado geral. TP geral precisa ser positivo. Uma especialidade sem TP mantém suas horas de imediatas na consolidação em HH; não se divide por TP zero.
- Com esse teto, RS não supera 100%. A faixa contratual superior permanece apenas informativa; exatamente 95% tem fator contratual 0,00, conforme regra confirmada.
- Alpinismo (Alpinista/Alpinistas/Alpinismo da base) fica visível, mas não entra no HH disponível, TP, TCpr, TCoi, ocupação ou RS. Nenhum registro de disponibilidade foi apagado.
- Os centros exatos INSPPINT, TECNIEND, TECNINSC e HIDROJATO seguem a mesma exclusão, independente da especialidade. Centros elegíveis e de acompanhamento da mesma especialidade são agrupados separadamente. As exclusões também se aplicam às pendências e justificativas do RS; a opção de acompanhamento pode exibi-las sem alterar o indicador. A capacidade diária operacional continua incluindo todos esses centros.
- O filtro IARI/ROTINA aplica-se à capacidade, HH SAP, RS e evidências. O teto é recalculado no recorte; devido ao teto, não se somam nem se faz média dos RS dos locais para obter o geral.

## Fontes e conciliação

`get_weekly_realization` consulta `activities`, `sap_confirmation_imports`, `sap_confirmation_rows` e `weekly_rs_availability`, sempre para a mesma semana/obra. Retorna agregados por centro, não todos os apontamentos.

Cada linha SAP confirmada com HH positivo é classificada uma vez. Confirmações são normalizadas quanto a zeros à esquerda e sufixos decimais. TCpr exige confirmação na programação em dia coberto pelo intervalo real SAP. Caso contrário, código 2 entra em TCoi; código 1 fica fora do RS, e outros códigos geram aviso de classificação. Dias repetidos da programação não multiplicam uma linha SAP. Execução fora da semana ou sem datas gera aviso de prévia, sem rateio arbitrário entre semanas. Estornos devem ser conciliados na origem.

O centro vem de `CenTrab`/`CENTRO_DE_TRABALHO`/`Centro de trabalho` (fallback `specialty`) na programação e de `work_center` no SAP. O vínculo para o nome da especialidade vem apenas da disponibilidade fornecida. Não se inferem grupos por prefixo. Centros com HH relevante ausentes da tabela bloqueiam o geral, com lista explícita.

## Entrada de disponibilidade

## Análise por local e tarefas sem apropriação

`get_weekly_rs_analysis` retorna agregados por centro/local. Associações SAP/programação são calculadas em lote por confirmação normalizada, evitando varreduras correlacionadas por linha. `get_weekly_rs_pending` pagina até 100 linhas (50 na tela), com busca e filtro de justificativa no servidor. O helper `weekly_rs_activity_evidence` não pode ser executado diretamente por usuários.

O local da tarefa vem de `planning_data.Local`, com fallback no vínculo único da disponibilidade. Para SAP, usa-se o local único das tarefas de mesma confirmação e intervalo real; para externas, o vínculo único do centro. Local ambíguo não é inferido por prefixo e bloqueia o RS filtrado se houver HH elegível sem local.

A evidência por tarefa/dia exige linha SAP CONF com HH positivo e período cobrindo o dia. Dias sem cobertura de uma confirmação parcial continuam na lista. HH sem período identificável é indefinido, não um falso confirmado/pendente. Sem carga, os indicadores de apropriação/pendência ficam ausentes, não zero. Canceladas/não executadas mantêm seus status: ausência de apropriação não implica execução pendente.

Justificativas e observações vêm do apontamento atual NEXO. O autor/data da justificativa são obtidos somente de evento que alterou esse campo para seu valor atual; não se atribui autoria ao último editor de PT/status. Ausência de evento fica explícita. Não são inventados motivos a partir do SAP. O HH programado das linhas sem apropriação não é saldo de HH SAP.

Motivos clicáveis e busca afetam somente a lista. Alpinismo pode ser incluído na lista para acompanhamento sem mudar os indicadores oficiais. `tests/weekly-rs-analysis.sql` cria três dias com uma apropriação em apenas um, verifica os outros dois como pendentes, concilia locais/motivos e valida acesso ao helper; tudo termina em ROLLBACK.

## Manutenção da disponibilidade

Em Painel → Disponibilidade HH, selecionar semana e preencher diretamente, colar seis colunas do Excel ou importar a aba `Disponibilidade`/`Ocupação` de um arquivo Excel. A aba pode coexistir com Programação; esse importador lê somente a disponibilidade e não altera tarefas. A importação usual da programação permanece independente. O resultado fica na aba Realização Semanal.

Uma semana sem disponibilidade recebe um rascunho da última base salva de uma semana anterior da mesma obra, ordenada pela data de atualização. O rascunho precisa ser conferido e salvo para entrar no indicador. Ao reutilizar, preserva-se o dia da semana, não a posição da linha: terça continua terça. Dias sem referência (por exemplo, segunda depois de uma semana curta) ficam em branco e exigem HH informado, inclusive zero. Semanas já salvas não são alteradas quando a base de outra semana muda.

Colunas: CENTRO DE TRABALHO, DATA, HH DIÁRIO DISPONÍVEL, SEMANA, LOCAL, ESPECIALIDADE. Aceita também o cabeçalho ESPECIALIDAE do exemplo. Datas devem pertencer à semana selecionada, HH deve ser numérico e não negativo (vazio não vira zero). Não admite duplicata centro/data/local nem um centro associado a especialidades diferentes na mesma semana.

Importar/colar apenas prepara um rascunho. O usuário revisa e confirma Salvar disponibilidade; o indicador usa somente a última versão salva. A tabela de edição é paginada para não renderizar milhares de inputs simultaneamente. Rascunhos não são substituídos por atualizações em segundo plano.

## Segurança e implantação

O menu segue as permissões SAP: planejamento/administrador. As RPCs também conferem perfil aprovado e acesso à obra no servidor; tabelas com RLS e escrita direta bloqueada para usuários comuns. Gravação com versão esperada impede sobrescrita concorrente. Cada salvamento produz histórico com conteúdo, origem, responsável, versão e data, em `weekly_rs_availability_history`. A tela mostra versões paginadas com responsável, momento, origem, HH anterior e HH salvo; não baixa todas as tabelas históricas para listar o histórico.

Migrações equivalentes: `supabase/migrations/20261022120000_weekly_realization.sql` e `drizzle/migrations/0014_weekly_realization.sql`. Aplicadas em 22/10/2026; alterações futuras de esquema devem usar uma nova migração. Nenhuma tabela de atividades ou SAP é modificada por elas. A carga inicial assistida da RPBC usa a tabela fornecida da semana 41 adaptada, com autorização, a 13–16/10 da semana 42, corrigindo SOLD_MLP de sexta para 17,6 HH. A segunda versão inclui ALP_PINT com 114,4 HH em cada dia, conforme confirmação, totalizando 304 linhas e 11.981,2 HH.

Verificação: `node --test tests/weekly-realization.test.mjs tests/weekly-availability.test.mjs`. O roteiro SQL `tests/weekly-realization.sql` exige JWT de planejamento/admin configurado; realiza gravações de teste dentro de transação e termina em ROLLBACK. Testa conciliação por centro e carga, persistência, auditoria, duplicatas, versão antiga, datas/semana e HH inválidos.
