# Base oficial de programação do RS

O modelo semanal contém Acompanhamento (tarefas diárias), Dados e Programação SAP (exportação original, 22 colunas). A aba Programação SAP tem uma linha por confirmação, com o HH completo na coluna Trabalho. Número e Duração normal não multiplicam novamente Trabalho. Datas originais ficam preservadas como evidência, mas todo o Trabalho pertence à semana selecionada.

A importação semanal salva as duas bases separadamente. Arquivos antigos sem a nova aba continuam compatíveis e mostram explicitamente o cálculo pela programação operacional. Uma aba SAP presente, porém vazia ou inválida, impede o envio antes da criação da semana. Se a gravação da base oficial falhar depois da criação operacional, o aviso orienta a importar somente a base no Painel → Realização Semanal, sem duplicar atividades.

No RS, Importar base oficial RS permite substituir a base da semana aberta, com confirmação de arquivo, quantidade e HH. Cada substituição usa controle de versão, responsável e horário. Não altera atividades, PTs, status, disponibilidade ou cargas SAP. Semana fechada exige reabertura administrativa; versões de fechamento existentes são imutáveis.

O TCpr vincula a apropriação SAP positiva à confirmação da base oficial, sem condição de data operacional. Aplica min(SAP, Trabalho) por confirmação antes do teto semanal por especialidade. Confirmações não presentes continuam sujeitas às regras de código 1/2. FUNILEIR0293 usa FUNILEIR. Exclusões contratuais e fatores não mudam.

O fechamento preserva a base corrente e seu histórico junto da memória de cálculo. Os arquivos JSON e Excel de fechamento incluem essas fontes; o Excel expande cada confirmação e suas colunas originais. As telas operacionais continuam com o vínculo diário anterior.

Validação: 65 testes unitários/integração de código, TypeScript e build completos; regressão SQL em transação revertida cobre resultado independente da semana 43, controle de versão, duplicidade, imutabilidade, exportação congelada, semana fechada e acesso anônimo. Após a carga oficial das semanas 42–44, os hashes das 4.261 atividades e 12.511 registros SAP permaneceram iguais. Semana 43: 15.684,1 HH programados elegíveis, 14.916 HH disponíveis, 11.702,1 HH considerados, RS 78,45333869670152%. Nenhuma publicação é acionada por estas alterações.
