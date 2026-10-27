# Evolução semanal do RS

Painel ao fim de Gestão Operacional → Realização Semanal. Não altera cálculos, dados nem permissões.

- Usa `get_monthly_rs_weeks(p_worksite_id, p_week_ids, p_local)`, a mesma fonte governada da seleção de semanas, e mostra `calculation.result.rs` e seu fator sem recalcular ou fazer média.
- Ano/mês e local da tela recortam o histórico. A seleção de semanas acima destaca as barras, sem remover o contexto das demais semanas do período.
- Histórico paginado em até 12 semanas, ordem cronológica, mais recentes inicialmente. Carrega ao entrar na área visível, cache de cinco minutos, sem polling e sem refetch ao focar a janela. Botão próprio permite atualização manual.
- Fechamento oficial usa resultado congelado da RPC. Em apuração usa o resultado vigente e barra tracejada. Ausência/invalidez mantém `null`, nunca vira zero. O zero real continua sendo zero.
- Cores seguem o fator já calculado: vermelho −0,02, âmbar −0,01, verde 0, azul +0,01. Eixo começa em zero e permite valores acima de 100%; referências de 95% e 98%.
- Rótulos abreviados com semana/ano; tabela expansível oferece nome completo, datas, resultado e pendências, também para consulta sem mouse/cor. Em telas estreitas, rolagem dentro do gráfico preserva os rótulos.

Validação: testes puros em `tests/rs-weekly-evolution.test.mjs`; regressões de RS/disponibilidade/seleção; TypeScript e build Vite. Consulta somente leitura confirmou resultados válidos para as semanas 42, 43 e 44. Não é uma publicação automática.
