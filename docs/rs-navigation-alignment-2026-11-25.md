# Alinhamento da navegação na evolução do RS

Correção local, não publicada: btn-outline não possui definição em src/styles.css. Substituída nessa região por btn-ghost existente (inline-flex, alinhamento central, gap, bordas e estados). Anteriores/Recentes agrupados em grid de duas colunas iguais, altura h-9, largura mínima igual, texto sem quebra e ícones shrink-0. Em tela estreita o par ocupa largura disponível. Botão atualizar mantém dimensão quadrada e limpar usa mesmo estilo existente.

Não alterados índices de página, onClick, condições de desabilitação, query, filtros ou cálculos. Dez testes focados passaram, incluindo teste de regressão de classes e layout. diff --check passou. Revisão visual em navegador não executada; não alegar validação visual em produção.
