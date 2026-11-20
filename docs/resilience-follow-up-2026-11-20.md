# Continuidade operacional — segunda revisão de 20/11/2026

Revisão direta, sem IA da Lovable, sobre o código publicado `80ae55b1a169915ee6004f821e290f3888f0c073`. Nenhuma gravação de teste no banco de produção.

## Correções

- **Formulários fechando:** `Modal` recebia `closeOnBackdropClick=false`, mas ignorava esse parâmetro. Agora o fundo respeita a proteção; a ação explícita de fechar continua disponível e tem `type=button`, sem submissão involuntária. Isso atende os formulários já protegidos de Hora Extra, Mudança de Escala e Fiocruz.
- **Tempo real indisponível:** Atividades RPBC acompanha o estado do canal. Quando o canal falha ou não conclui a conexão, uma alternativa de leitura consulta tarefas e histórico ativo a cada 60–80 segundos. Não executa mutações, não altera rascunhos, não sobrepõe suas próprias consultas, respeita aba oculta/rede offline e é removida na troca de semana/desmontagem. Há distribuição aleatória entre clientes e limite de frequência ao retornar à aba. Uma indicação informa quando o modo periódico está ativo.
- **Sessões longas/ociosas:** o navegador que precisou da rota alternativa a mantém enquanto ela funciona. Depois de um período ocioso, o histórico limitado da rota permite escolher o relay antes de enviar o refresh token, evitando primeiro consumi-lo por uma rota conhecida por falhar. A preferência de rede não é autorização, não prolonga token/sessão e não relaxa RLS. Resultado de refresh incerto continua protegido contra reenvio.
- **Rascunho de Hora Extra:** chave por usuário e obra, validação de tipos/campos restaurados e tratamento de falhas do `sessionStorage`. A indisponibilidade do armazenamento é informada e não derruba o formulário nem impede a conclusão de um envio já confirmado. O rascunho legado sem identificação não é atribuído automaticamente a outro usuário; não foi apagado.
- **Listas operacionais:** leitura de colaboradores e solicitações de Hora Extra pode usar o relay, com filtro explícito de obra, JWT do solicitante, métodos/consultas restritos e chave pública. As políticas existentes foram inspecionadas: acesso por obra/perfil e gate de senha restritivo. Não houve alteração dessas políticas, aprovação de horas, cadastro de pessoas ou outra gravação de negócio.
- **Troca de obra/cancelamento:** chaves de cache de colaboradores/solicitações incluem obra/usuário; leituras paginadas passam a receber o sinal de cancelamento. O modal novo de Hora Extra é remontado por identidade/obra para não transportar um formulário de outro contexto.

## Validação e limites

Testes de componente com elementos React reais para o modal; relógio/rede simulados para falha de canal, reconexão, abas ocultas, concorrência, expiração da rota e refresh; testes do SDK real com respostas simuladas; suítes existentes, TypeScript e build de produção.

Isso não substitui validação na rede Petrobras nem teste de carga com todos os usuários. A primeira falha de refresh em um navegador sem histórico pode ter resultado incerto; nesse caso não se repete o token, e uma nova autenticação pode ser necessária. A atualização periódica não equivale a tempo real instantâneo, nem confirma que um salvamento foi feito.

Outras consultas/fluxos não listados, recuperação por e-mail, pesquisas específicas de atividades para novas solicitações e escritas diretas da Fiocruz ainda podem depender do acesso ao backend externo. Não foram liberadas gravações genéricas no relay para contornar isso. Uma interrupção completa da hospedagem/origem do NEXO também não é resolvida por esse mecanismo.

Publicação depende de autorização; nenhuma nova publicação foi iniciada nesta segunda revisão.

## Ajuste posterior solicitado pelo usuário

Após publicar a segunda revisão, foi removido o aviso técnico amarelo sobre a conexão em tempo real. A alternativa de atualização periódica permanece ativa silenciosamente; não houve supressão de erros de salvamento ou confirmação falsa de envio.
