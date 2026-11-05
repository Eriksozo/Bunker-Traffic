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

## Preferências por exemplos de pausa

Exemplos enviados pelo dono são evidência da escolha que ele faria, com campanha, período, gasto e aquisição conforme a fonte. Uma venda isolada não implica preservar uma campanha deficitária; métricas de clique/retenção favoráveis também não demonstram aquisição rentável. Registrar a preferência no projeto correto, sem transformar os valores de um print em limite universal ou registrar uma pausa como aplicada. A preferência pode orientar a discussão; sua eficácia permanece em estudo até haver comparação verificável e revisão.

Separar pausa por aquisição sem sustentação, redução de exposição preservando aquisição útil e observação quando faltam dados novos ou existe retomada de incidente. A escolha depende do contexto próprio. O recorte pós-ajuste deve declarar a janela real e a fonte: horas de vários dias, hora que cruza a edição, hora ainda aberta e pedidos com upsells não comprovam novas vendas front após o ajuste.

## Evolução individual e contrapontos — versão 2

Cada chamada real do analista na Cloudflare produz uma reflexão curta: hipótese, incerteza, próxima conferência, até oito citações numéricas e até três contrapontos. O autor é a função da reserva autenticada. Não existe campo para o agente se dar nota ou liberar execução.

- **Lia:** aquisição front, CPA, checkout e dados após a última edição.
- **Nina:** conjuntos/anúncios, identidade da peça, origem das vendas e incidentes do funil.
- **Theo:** moeda nativa, exposição, tetos e alterações recentes. Aprovação de um colega não equivale à do dono.
- **Cai:** confronta os três pareceres, explicita incerteza e sintetiza uma sugestão revisável.

As citações precisam existir no pacote efetivamente apresentado ao modelo, com número bruto exato, período, conta e objeto. Na gravação são novamente conferidas nas fontes congeladas. Métrica ausente, arredondada, repetida, omitida na compactação ou de outra conta invalida a reflexão. Filhos precisam pertencer à campanha referenciada. Conferir o número não comprova que a interpretação está certa.

Cada contraponto aponta para uma conclusão real, de outro papel, na mesma rodada. Não se inventam conversas nem se permite autoconsenso. A síntese financeira fica retida quando faltar o confronto dos três papéis, houver dúvida/contestação material ou pergunta pendente. O dado atual continua obrigatório; lembranças de outra rodada não substituem uma releitura. Os limites de mensagens, tentativas e leases já existentes continuam valendo. Uma discussão inconclusiva exige nova leitura elegível, não um loop sem fim.

A memória fica separada por projeto e papel. Recupera até três episódios recentes e diversos, priorizando o mesmo objeto/conta, com no máximo trinta dias. Inclui contrapontos recebidos, escolhas pertinentes do dono e revisões reais das propostas. Escolhas e rejeições são feedback de processo, não resultado financeiro. Casos contrários e hipóteses invalidadas continuam sinalizados; nenhum texto gerado promove a si próprio a regra validada.

O histórico completo da reflexão é arquivado atomicamente com a colaboração. Um cache mantém até oito episódios arquivados por projeto/papel para a próxima rodada; isso é amostragem declarada, não remoção do histórico. Repetir a gravação pelo mesmo clientId não gera episódio novo. A UI mostra reflexões com números conferidos e contrapontos; não exibe uma taxa de acerto financeiro inventada. A validação econômica continua no ciclo prospectivo da versão 1.

### Referências externas consultadas

Os repositórios foram baixados apenas para revisão, fora da aplicação. A implementação JavaScript é própria, sem instalar os runtimes Python ou executar scripts desses repositórios. Commits, arquivos e licenças consultados estão em `docs/references/agent-learning-sources.json`.

- [LangMem](https://github.com/langchain-ai/langmem): separação de memórias e namespaces; reflexão e recuperação delimitada.
- [AutoGen](https://github.com/microsoft/autogen): críticas entre papéis com condições de encerramento. O README indica evolução para Agent Framework; a referência aqui é o mecanismo delimitado no commit consultado, não adoção do runtime.
- [DSPy](https://github.com/stanfordnlp/dspy): avaliações com métricas e exemplos explícitos. Não há otimização automática dos prompts em produção; mudanças desse tipo precisam superar a avaliação de regressão.

As referências não são evidência de lucro do Bunker nem fonte de metas de clientes. Os testes de regressão cobrem números inventados, falta de dados, identidade, autoria, replay, isolamento de projetos, memória antiga, cache/histórico e retenção de sugestões em desacordo. Nada disso constitui promessa de decisão perfeita.

## Fechamento automático e ecossistema — versão 3

O executor Cloudflare passa a priorizar comparações elegíveis antes de uma nova análise, preservando a prioridade de confirmações e ações já aprovadas. A unidade usa somente leituras salvas e processa até duas aplicações. Não inicia coleta fora da cadência, não chama o modelo para inventar métricas e não executa comandos no Malva.

Cada caso exige proposta Meta aprovada, versão e assinatura correspondentes, confirmação por leitura posterior e dias encerrados de igual duração/fuso antes e depois. Reutiliza as medições preservadas pelo Bunker quando as fontes correntes forem substituídas. Dados ausentes, gasto zero, incidentes, outras edições e comparações divergentes não viram sucesso. A tentativa limitada fica registrada; só uma mudança de evidência permite outra avaliação. Os limites de histórico preservam as evidências existentes.

As comparações são classificadas como favoráveis, desfavoráveis ou inconclusivas pelos mesmos critérios econômicos e de aquisição já publicados. Ficam disponíveis ao papel que analisa o mesmo projeto, conta e campanha. Um resultado da equipe não recebe crédito individual e não transforma uma hipótese em regra validada. A validação prospectiva e a revisão independente continuam necessárias para promover padrões.

A memória individual recebe correções do dono e resultados medidos; um caso desfavorável passa a ser prioridade de investigação. A dashboard mostra a quantidade de aplicações medidas e as correções relacionadas aos episódios recentes de cada papel, sem apresentar uma taxa de perfeição.

A leitura do cache Órbita passa a integrar o contexto do modelo: nomenclatura, nome Meta, origem declarada, estágio e expert/squad. O vínculo exige nome exato nos anúncios das campanhas priorizadas. Duplicidades não são resolvidas por suposição; não remover sufixos de Avatar ou limpeza automaticamente. Produção publicada ou resultado informado na Órbita não comprova receita atribuída na Meta.

O contexto declara disponibilidade, idade e cobertura apenas dos registros retornados. Uma coleta pelo MCP do chat pode atualizar o cache, mas não constitui credencial independente da Órbita na nuvem. Quando o cache vence, o agente recebe a limitação, sem alegar consulta ao vivo ou ausência de criativos. A conexão financeira permanece exclusivamente pelo MCP Malva, nos valores e na versão aprovados pelo dono.
