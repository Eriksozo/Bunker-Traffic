# Ciclo de aprendizado dos agentes — versão 1

Este processo melhora as sugestões usando memória verificável, revisão independente e avaliação posterior. Não treina os pesos de um modelo e não promete decisões perfeitas. Aprovação e resultado financeiro continuam separados.

## A cada análise elegível

1. Consultar `plan.learning` em `bunker_ler` ou `bunker_colaboracao` com `action: learningRead` e `projectId`. A coleta respeita dias, horários, pausa e cadência existentes.
2. Lia registra a hipótese contextual em `knowledge`: cenário, ação, motivo, alternativas e condição de abandono. A revisão é congelada antes dos casos futuros.
3. Nina procura problemas de aquisição/identidade do criativo. Theo testa exposição e resultado econômico. Cai reúne divergências sem simular consenso. Cada contribuição usa uma execução e reserva reais.
4. Registrar a escolha do dono na interface. Conferir a aplicação pelo contrato existente; uma escolha ou aprovação não é execução.
5. Comparar leituras fechadas antes/depois do mesmo objeto e conta, com igual duração/fuso. Usar `outcome` com `knowledgeId`. O servidor sela a revisão e data da hipótese. Casos históricos não contam como testes prospectivos.
6. Para mudanças de outros gestores, importar o histórico Malva completo, registrar `decisionHistoryOutcome` e associar `outcome.historyOutcomeId`. O servidor revalida a comparação e a confirmação Meta. Não copiar metas entre clientes.
7. Tráfego ou criativos e orçamento revisam a evidência por `learningReview`, durante suas etapas ativas. O gestor não se autoavalia. Os revisores precisam de execuções diferentes e do fingerprint exato retornado em `learningRead`.
8. Rever o backlog em cada rodada. Resultados desfavoráveis e inconclusivos permanecem visíveis. Nenhum histórico é removido para melhorar uma taxa.

## Parecer de aprendizado

Enviar pelo MCP autenticado, relendo a revisão central antes da escrita:

```json
{
  "action": "learningReview",
  "revision": "REVISAO_CENTRAL_REAL",
  "roundId": "RODADA_REAL",
  "claimId": "RESERVA_REAL",
  "executionRef": "EXECUCAO_REAL",
  "clientId": "ID_UNICO_REUTILIZADO_NO_RETRY",
  "entry": {
    "project": "PROJETO_REAL",
    "knowledgeId": "APRENDIZADO_REAL",
    "knowledgeRevision": "REVISAO_NUMERICA_REAL",
    "evidenceFingerprint": "FINGERPRINT_DE_LEARNING_READ",
    "verdict": "support",
    "reason": "O que foi conferido, o que contradiz e quando não usar."
  }
}
```

Os campos de revisão são inteiros no pedido real; os marcadores acima ilustram o contrato. Pareceres possíveis: `support`, `challenge`, `inconclusive`. O autor vem da reserva conferida, não de um nome fornecido pelo chamador. Retry idêntico devolve o registro original; conteúdo diferente não pode reutilizar o clientId. Novas evidências ou revisão da hipótese invalidam o apoio anterior, preservando os registros.

## Estados e critérios

| Estado | Significado |
| --- | --- |
| Em estudo | Há hipótese/fontes, mas não resultado verificável. |
| Em validação | Há medições, mas faltam casos futuros ou revisão independente. |
| Revisar padrão | Houve contestação, resultado desfavorável na versão atual, invalidação ou fonte antiga. |
| Apoio às sugestões | A versão passou pelos mínimos operacionais e pelos revisores. Não é autorização financeira. |

Para apoiar sugestões: cinco campanhas/contas distintas após registrar a hipótese, pelo menos três dias, sinais econômicos e de aquisição favoráveis em pelo menos 80% dos casos e revisão de orçamento mais tráfego/criativos. A mesma campanha/conta só conta uma vez por versão. Qualquer resultado desfavorável da versão atual pede investigação; uma nova versão precisa de novos testes posteriores e revisores. Os mínimos são uma triagem conservadora, não significância estatística ou prova causal.

A comparação observa ROI, resultado econômico e front em conjunto. Sinais mistos ficam inconclusivos. Pausas sem exposição posterior comparável não recebem um sucesso fabricado. O motor recusa fontes incompletas, valores divergentes, janelas sobrepostas, fuso inconsistente, sincronização insuficiente, aquecimento e interferências de incidentes/edições. Ausência de alterações no histórico não prova ausência de fatores externos.

## Placar

- Concordância: escolhas comparáveis em que ação e percentual sugeridos coincidiram com a escolha do dono. Diagnósticos e sugestões ausentes ficam fora do denominador. Não mede lucro.
- Evidência: casos verificados, independentes, posteriores ao registro, favoráveis, desfavoráveis e inconclusivos.
- Pendências: escolhas sem aplicação/resultado conciliado. Não pressupõem que algo foi aplicado.
- Uso: padrões que podem apoiar uma nova análise local, sempre com fontes atuais e ressalvas.

Nenhum indicador muda orçamento, status Meta, metas, proteções de teste, limites ou cadência. A execução continua vinculada à proposta exata aprovada pelo dono e ao protocolo de envio único. O processo é entregue no runbook publicado; os agentes o consultam nas rotinas já existentes, sem criar outro agendador ou alegar aprendizado concluído antes das medições.
