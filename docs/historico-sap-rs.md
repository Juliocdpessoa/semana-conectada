# Histórico SAP e Realização Semanal

## Uso

- Painel → Realização Semanal abre na semana operacional. “Em apuração” usa a última carga SAP detalhada dessa semana.
- Ano, mês e semana permitem consultar o histórico da obra. São carregados apenas os identificadores das semanas; detalhes e pendências são consultados por semana/página.
- Planejamento mantém até seis semanas recentes na lista curta (preparação, operacional e quatro anteriores quando presentes). As demais continuam no histórico do Painel. O antigo bloqueio de quatro semanas foi removido; não é preciso apagar uma semana para importar outra.
- O administrador usa **Fechar agora** com justificativa. São preservados resultados geral/IARI/ROTINA, regras, programação completa, apontamentos, justificativas, históricos, disponibilidade e carga SAP oficial.
- O prazo SAP bloqueia novas cargas, mas **não cria sozinho um fechamento oficial**. Após a conferência, o administrador precisa fechar. Prorrogar prazo permanece disponível no Planejamento.
- **Reabrir fechamento** não apaga versões. O próximo fechamento gera nova versão. A consulta de uma versão antiga lê seus dados congelados, sem aplicar fórmulas futuras.
- Exportar fechamento Excel gera abas analíticas e fontes; Arquivo completo JSON preserva também estruturas aninhadas. Um campo além do limite do Excel exige usar JSON.
- Histórico de cargas SAP abre sob demanda e permite baixar cada carga estruturada ainda existente. Não é uma cópia binária do Excel originalmente enviado.

## Segurança e conservação

- Planejamento/administrador com acesso à obra podem consultar. Somente administrador autorizado pode fechar/reabrir. Os endpoints validam a obra também no banco.
- Versões e cargas SAP são somente acréscimo. Não há limpeza automática nem exclusão de semanas que tenham versões oficiais.
- Nenhuma semana real foi fechada pela migração. Semanas antigas sem versão são identificadas como consultas recalculadas, não fechamentos oficiais históricos. Dados previamente removidos não são recriados.
- Atualizar a disponibilidade de outra semana não altera a memória de um fechamento existente.
- O histórico aumenta o armazenamento ao longo dos anos, mas não é integralmente carregado no uso diário. A capacidade deve ser acompanhada; esta mudança não garante que o plano atual comporte cinco anos.
- **Backup externo não foi configurado.** Recomenda-se guardar os arquivos JSON/Excel de cada fechamento em repositório corporativo com controle de acesso e validar restauração. Download não exclui os dados no NEXO.

## Verificação desta implementação

- Comparação SQL congelado × cálculo TypeScript para geral, IARI e ROTINA da semana 42, com tolerância numérica de 1e-7.
- Transações revertidas verificaram fechamento, idempotência, reabertura, versão anterior intacta, nova versão, fontes/pêndencias preservadas, imutabilidade e recusa de consulta por líder.
- A autenticação do preview não estava disponível para teste visual; não confundir build/testes com validação visual autenticada.
