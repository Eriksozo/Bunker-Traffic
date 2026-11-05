# Registro de intenção separado da execução

O dono pode registrar Aumentar X%, Reduzir X%, Pausar ou Manter enquanto a análise está vencida, o cenário mudou ou faltam pareceres. O registro não chama o Malva, não aprova proposta e não cria autorização financeira. A referência exibida continua vinculada à análise consultada, sem substituir valores por dados novos silenciosamente.

As intenções financeiras ficam pendentes de revisão e entram no fluxo existente de conferência dos agentes. A fila respeita pausa, trabalhos já pendentes e execuções que ainda precisam de confirmação. Manter é registrado no histórico sem gerar comando. O card sai da fila após o recibo confirmado da central, com possibilidade de reavaliação pelo histórico.

Para executar, permanecem obrigatórias uma proposta exata revisada, fonte atual, aprovação do dono para a versão e valores, contingência, envio único e leitura posterior. A condição `approveExact: true` continua submetida a todas as proteções. O formulário identifica explicitamente o botão de intenção como uma ação que não executa.

Continuam bloqueados: identidade desconhecida, aumento/redução sem orçamento diário e moeda válidos, pausa de status já pausado na referência e aumento em conta explicitamente desabilitada. A pausa do escritório também continua respeitada. Nenhuma meta ou teto foi inventado para liberar o formulário.

Regressões verificam intenções com análise vencida, contexto de incidente, alteração de assinatura, precisão dos valores, duplicação de escolhas e impossibilidade de usar o caminho de intenção para aprovar propostas ou despachar comandos.
