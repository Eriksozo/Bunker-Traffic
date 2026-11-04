# Revisões rápidas na dashboard

A interface da Cloudflare tem uma área **Revisões dos agentes**, com fila por projeto, coleta dos quatro períodos, pareceres de tráfego/criativos/orçamento, síntese e propostas aguardando aprovação. Os dados vêm dos registros persistidos; não há porcentagens de tempo ou presença simulada. O relógio informa tempo decorrido, não previsão de término.

**Solicitar revisão** cria somente um pedido interno autenticado. A seleção de todos os projetos enfileira os disponíveis em uma transação. Pedidos repetidos preservam o mesmo recibo e não duplicam jobs. Coletas, pareceres, propostas e conferências em andamento ficam protegidos. A pausa do painel bloqueia novos pedidos. O pedido manual não muda a agenda, não reserva coleta nem concede autorização financeira.

O Mac mantém as integrações OAuth e executa os agentes. A fila e os resultados ficam no backend da dashboard. A execução ainda depende do Mac ligado e disponível; esta mudança não transfere credenciais nem modelos para a Cloudflare.

## Redução do contexto

`bunker_ler` entrega configuração, relógios e contagens, próximo trabalho e referências de leitura. Pareceres antigos, históricos de aprendizados e relatórios completos deixam de ser repetidos a cada conferência da revisão. Os dados originais permanecem salvos para consulta. Autorização e recuperação de execução continuam no plano prioritário, com referência para a versão exata.

O contrato de leitura `bunker_atualizar_rodada` aceita `{id:'review-data',status:'Pendente',revision:0,note:JSON.stringify({action:'read',projectId,section,...})}`. Não permite escrita:

- `context`: configuração do projeto, rodada, etapas, opiniões da rodada, incidentes, últimas mudanças e referências das fontes.
- `sources`: período e nível exatos, conta/objeto opcionais, limite de 1 a 50 e cursor retornado. O cursor é vinculado ao projeto, rodada, filtros e fingerprint da leitura. Mudança de fonte exige reiniciar a paginação. Fonte bloqueada ou fora do recorte selado não é exposta como evidência válida.
- `execution`: proposta e execuções exatas por `proposalId`/`executionId`, no projeto indicado. Uma confirmação pendente continua acessível mesmo se a análise estiver velha; a leitura nunca concede novo envio.

Ausência de fonte é distinta de fonte vazia. Contagens de progresso não substituem fontes ou pareceres. Publique a contribuição de cada projeto quando confirmada, sem esperar os demais. Aprendizado continua por projeto; não copiar metas e não produzir consenso com personas fictícias.

O executor preserva `executionClaim/Prepare/Submit/Confirm`: apenas a primeira resposta de submit com `dispatchGranted:true` permite o comando exato uma vez. Respostas ambíguas continuam somente para conferência. Uma solicitação de revisão não aprova nem altera campanhas.
