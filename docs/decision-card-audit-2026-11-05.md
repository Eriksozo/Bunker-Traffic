# Auditoria do card de decisão — 05/11/2026

## Correções

- O editor está vinculado ao ID e à assinatura da análise aberta. Uma substituição de fonte fecha a edição e informa que a escolha não foi enviada; não transfere silenciosamente um rascunho para novos valores. Durante um envio, o recibo da central continua sendo a autoridade.
- Mudança de projeto limpa rascunhos e confirmação da aprovação.
- A proposta exata exige expiração válida, versão inteira positiva e segura, assinatura, projeto, conta, objeto, provedor e moeda correspondentes. Releitura pendente invalida a apresentação como aprovação exata.
- Percentuais usam entrada decimal; notação científica, hexadecimal e dados inválidos não são convertidos em escolhas. Percentuais derivados dos valores de uma proposta mantêm a precisão necessária para reproduzir os centavos aprovados.
- Antes de salvar, o valor deve produzir orçamento diário positivo, diferente do anterior, dentro do limite já existente do domínio. Orçamento vitalício não é tratado como diário.
- O clique final revalida os pontos de contingência, inclusive colisão com outra execução e mudanças de cenário.
- O modal de aprovação bloqueia fechamento por Escape e clique externo enquanto envia, assim como já fazia o editor.
- O histórico só apresenta aplicação conferida com o recibo arquivado ou com proposta, versão, identidade, valores e leitura posterior realmente correspondentes. Um status isolado de execução confirmada não basta. Leituras posteriores ao próprio instante de confirmação são rejeitadas como prova inconsistente.
- Contas explicitamente inaptas não aceitam aumento no card. Uma inaptidão nova também bloqueia aumento/ativação na pré-conferência do executor. Pausa e redução seguem possíveis para contenção.
- O histórico recebe os metadados dos períodos salvos para exibir a origem das métricas.

## Validação

Suíte completa do projeto, checagem TypeScript, build de produção e testes novos de regressão para formulário, precisão em centavos, expiração, mudança de assinatura, confirmação e conta desabilitada. A suíte também cobre duplicação/idempotência, resposta perdida, mudança de revisão, isolamento financeiro, envio único, releitura, reabertura e preservação do histórico.

A conferência no navegador é somente de apresentação e navegação. Não aprovar, pausar, aumentar ou reduzir campanhas de produção para testar a interface.

## Limites

Esta auditoria cobre os caminhos e falhas descritos; não demonstra ausência de todo defeito possível. Atualidade depende da origem Malva e das leituras disponíveis. Salvar escolha, autorizar execução, conferir aplicação e medir resultado financeiro permanecem eventos distintos. Metas, agenda, aprovação do dono e limites financeiros não foram ampliados.
