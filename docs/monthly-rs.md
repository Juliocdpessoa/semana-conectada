# Consolidado mensal do RS

Painel → Realização Semanal → Mensal permite selecionar de uma a doze semanas e consolidar explicitamente. Ano e mês organizam as opções; a seleção do mês inclui semanas que atravessam suas divisas. Semanas escolhidas entram integralmente, sem rateio de dias. O filtro IARI/ROTINA vale para todas as semanas, cartões, tabelas e cálculo.

O numerador soma os HH considerados de cada especialidade em cada semana, depois dos limites por confirmação e por especialidade já aplicados no cálculo semanal. O denominador soma o HH disponível elegível. RS mensal = numerador / denominador × 100. Não há média simples dos RS nem reaplicação de um teto mensal que permita compensação entre semanas. O fator usa o RS mensal sem arredondamento e as faixas contratuais vigentes. A ocupação geral acumula os TP considerados GERAIS de cada semana; cada especialidade conserva os seus próprios TP considerados semanais.

Semanas fechadas utilizam o frozenCalculation e a versão oficial preservada. Semanas abertas utilizam a apuração atual e sinalizam o consolidado como provisório. Uma semana sem SAP, disponibilidade, vínculo válido ou resultado válido impede o RS e o fator do conjunto; não é descartada nem convertida em zero. Falha de consulta não exibe resultado parcial. Legado fechado sem snapshot fica explicitamente pendente.

A função get_monthly_rs_weeks é somente leitura, valida perfil SAP, obra, semanas existentes, duplicidade, local e limite de seleção. Retorna apenas metadados e agregações das semanas; não carrega tarefas e históricos completos no navegador. A consulta só ocorre após Consolidar e no Atualizar/recorte local; marcar caixas não dispara consultas.

A composição mostra semana, situação, versão, origem SAP, disponibilidade e resultado. Especialidades expandem seus centros. O Excel registra seleção, local, situação, fontes e versões, além dos totais e detalhamentos. É uma exportação do consolidado observado, não um novo fechamento imutável no banco. Este incremento não cria comandos de fechamento mensal nem fecha/reabre automaticamente as semanas existentes.

Verificações: 75 testes de código e fórmulas, TypeScript, build cliente/servidor e regressão SQL revertida (inclui fonte congelada, dados ausentes, seleção duplicada e acesso). Semanas 42+43: 23.126,5 / 27.024,8 × 100 = 85,5751013883544%, conferido por cálculo SQL independente. Hashes de atividades, SAP, semanas e fechamentos iguais antes/depois. Preview abre sem sessão autenticada; revisão visual do painel protegido ainda depende de login. Sem publicação.
