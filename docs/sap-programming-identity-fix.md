# Identificação da programação na conferência SAP

A conferência da semana 43 classificava como não programadas as operações 440 e 470 da ordem 2031647610 (SERVENTE), embora as confirmações estivessem na programação e na base oficial do RS. O SAP conserva zeros à esquerda. A programação usa as confirmações sem esses zeros. A prioridade de correspondência falhava e a suboperação 10 (OPERMAQB) podia ocupar o vínculo da operação principal.

## Correção

- Normalizar confirmação, ordem, operação e suboperação somente na comparação. Os valores importados permanecem intactos.
- Uma confirmação preenchida exige igualdade normalizada. Outra confirmação da mesma operação não a substitui.
- Suboperação vazia corresponde à operação principal. Não corresponde a qualquer suboperação filha.
- Quando falta confirmação na programação, o vínculo exige ordem, operação e suboperação, além do centro quando disponível.
- A lista fora da programação exclui todas as linhas SAP vinculadas, não apenas o primeiro candidato de cada tarefa.
- O detalhamento usa a mesma fonte dos cartões. O código 1 ou 2 só classifica como não programada/imediata depois de verificar a ausência de vínculo.
- A alocação diária no cliente normaliza a confirmação antes de priorizar candidatos. Não altera a regra de datas, o HH original, os apontamentos, os limites de RS ou os fechamentos.

## Verificação

Os testes transacionais no banco usam a carga mais recente da semana 43 e são revertidos. As duas operações saem da lista indevida. A operação principal 440 vincula 17,8 HH e sua suboperação 10 vincula 8,9 HH. A principal 470 vincula 8,8 HH e sua suboperação 10 vincula 4,4 HH. Esses são os HH brutos da carga, não o crédito limitado do RS.

Também foram verificados o compartilhamento das contagens entre RPCs, os identificadores vazios/numéricos e a negação de acesso anônimo ou sem autorização. A aplicação da migração muda as consultas imediatamente no banco compartilhado. A atualização do cliente exige sincronização e publicação do app separadamente. Não reimportar a semana para corrigir este caso.
