# Gestão Operacional

O menu principal exibe Gestão Operacional no lugar de Painel. A antiga entrada Planejamento foi removida do menu e seu conteúdo passou a Gestão Operacional → Importações, após Disponibilidade HH. Visão geral, Não execução, Não justificadas, Realização Semanal e Disponibilidade HH permanecem disponíveis nas mesmas condições anteriores.

Importações é carregada sob demanda. O componente recebe sessão e abas sem depender do contexto da antiga rota. Somente os perfis planning/admin veem a aba e podem montar o módulo; seus controles de servidor e permissões permanecem inalterados. O perfil Planejamento não foi renomeado. A rota /planejamento preserva a verificação anterior de perfis e redireciona para /painel?view=importacoes. As abas permanecem acessíveis mesmo sem semana operacional ativa.

Nenhuma tabela, semana, programação, apropriação, histórico ou papel foi alterado. Modelo semanal, confirmação obrigatória da base RS, repetição somente da base em falha parcial, ativação e demais ações existentes foram mantidos. Verificações: TypeScript, build cliente/servidor e 87 testes, incluindo navegação, acesso, links antigos e validação de importação. A conferência visual autenticada depende de sessão no preview. Sem publicação automática.
