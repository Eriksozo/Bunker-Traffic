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

### Conferência obrigatória do aprendizado

No protocolo de memória da nuvem, todo papel precisa citar ao menos uma métrica bruta quando houver número disponível no pacote final. Para criativos, a citação precisa vir de um conjunto ou anúncio quando esses filhos tiverem dados visíveis. A exigência é recalculada depois de qualquer compactação; dados omitidos ou ausentes não geram citação obrigatória nem são convertidos em zero.

Cada agente confronta os papéis que já concluíram a mesma rodada, inclusive quando apenas observa e não sugere ajuste. Os IDs permitidos vêm das conclusões reais. `challenge` e `inconclusive` são respostas válidas; registrar confronto não significa concordar. A síntese financeira continua retida diante de discordância material ou pergunta não resolvida. Falta de evidência ou confronto exigido impede gravar uma reflexão concluída, sem preencher automaticamente o conteúdo pelo agente.

O modelo recebe exemplos exatos e limitados de citações disponíveis para reduzir erros de transcrição. São dados de referência, não lições ou pareceres fabricados. Reflexões antigas sem citação permanecem no histórico e nos contadores, mas não alimentam a memória recuperada para a próxima análise. Isso evita reforçar texto genérico por repetição. As tentativas continuam limitadas; não há um novo ciclo de chamadas ou aumento de permissões.

## Revisão autônoma e inscrição prospectiva — versão 4

Nas etapas normais de tráfego, criativos e orçamento, o executor inclui um padrão do próprio projeto que já tenha resultado verificável e ainda não tenha o parecer daquele papel sobre o fingerprint atual. Casos desfavoráveis e padrões em revisão têm prioridade. A hipótese, a revisão, as contagens, as janelas e as métricas brutas acompanham o pedido. São os resultados medidos, não a concordância com o dono, que fundamentam a revisão.

O mesmo chamado do modelo produz a análise atual e o parecer de aprendizado; não se cria outra agenda nem uma chamada adicional. O autor vem da reserva real e cada unidade tem execução distinta. O modelo pode apoiar, contestar ou considerar inconclusivo. O gestor não se autoavalia. O parecer e a conclusão da etapa são gravados na mesma transação; uma mudança no fingerprint durante o processamento adia somente a revisão do padrão, sem atribuir um parecer à evidência nova.

O pacote contém até oito casos, com perdas e casos não verificáveis primeiro. Quando houver omissão, a cobertura parcial fica explícita e não permite apoiar o padrão. Dados antigos, hipótese invalidada e caso não verificável também impedem apoio. Se a compactação de contexto precisar liberar espaço, remove o pacote inteiro e declara a revisão adiada; nunca remove casos silenciosamente. Casos sem resultado não geram parecer automático, e o histórico cheio preserva os registros existentes.

Na síntese, uma sugestão de ajuste pode apontar uma hipótese local, com ID, revisão e motivo específicos. O servidor registra a inscrição em `learningEnrollments` antes da aprovação e de qualquer execução. Esse registro separado sela proposta/versão/assinatura, projeto, conta, campanha, ação e data da hipótese; não modifica o orçamento proposto, a assinatura da proposta ou suas permissões. Uma associação incerta deve ficar vazia. A revisão financeira recebe essa inscrição para confrontar sua pertinência.

Sugestão, proposta e inscrição compartilham a mesma transação. Se a hipótese mudar entre a leitura do modelo e a gravação, esse conjunto é desfeito e a tentativa fica marcada como falha, liberando somente a própria reserva para nova análise limitada. Os IDs da sugestão e proposta são estáveis por reserva/alvo; não há repetição de comando financeiro nessa etapa. Histórico e tentativas anteriores permanecem preservados.

Quando uma aplicação já aprovada e confirmada tiver dias fechados comparáveis, a medição automática pode associá-la à hipótese previamente inscrita. A associação exige a mesma revisão e a inscrição anterior ao envio. Alterar a hipótese depois não transfere vitórias antigas para a nova versão: a comparação continua disponível como resultado da ação, mas fica fora da validação daquele padrão. Nada é inscrito retroativamente para melhorar uma taxa.

Os critérios para apoio permanecem: cinco campanhas independentes após o registro, três dias, pelo menos 80% de sinais favoráveis e revisão independente de orçamento e tráfego/criativos. Contestação, perda verificada ou fonte antiga mantêm o padrão em revisão. Isso torna a validação automática quando as condições existem; não treina pesos, prova causalidade nem habilita execução financeira sem aprovação do dono.

## Versão 5 — ajustes observados de outros gestores

A coleta Cloudflare passa a preservar o histórico paginado das campanhas priorizadas. A primeira consulta usa o período máximo disponibilizado pelo MCP (até 400 dias); o início da cobertura considera o intervalo realmente retornado, sem inventar um período completo quando a API informa datas nulas. Cada unidade lê no máximo três páginas de cem eventos por campanha. Páginas pendentes são retomadas em outra coleta elegível. Enquanto isso, a primeira página atual continua disponível para conferir edições recentes. Após concluir, a consulta incremental sobrepõe um dia ao último ponto coberto.

Somente orçamento diário e status de campanhas entram no registro financeiro observado. Edições de conjuntos, anúncios, criativos, lances e demais categorias ficam no histórico de interferências. Conta, campanha pai, moeda nativa, identidade Meta, ordem e cursor precisam conferir. Uma confirmação nativa anexada depois ao mesmo evento complementa a proveniência: não cria outra ação nem reescreve o valor ou autor original.

Em cada coleta já admitida pela agenda, no máximo um ajuste elegível dos últimos trinta dias recebe comparação. O sistema consulta a campanha exata no dia anterior e no dia posterior à ação, ambos fechados, com metadados de sincronização e dez métricas brutas, incluindo vendas front e pedidos separados. `tracking_ad_detail.daily.orders` não é usado como substituto de vendas front. A moeda de desempenho e a moeda nativa do orçamento ficam separadas. O período consultado deve estar coberto pelo histórico concluído.

Resultado sem confirmação Meta, edição concorrente na campanha/filhos, incidente operacional, paginação pendente, investimento insuficiente ou sinais mistos permanece inconclusivo. Os casos desfavoráveis são preservados. Falha de leitura gera uma pendência explícita, nunca zeros. As medições externas usam arquivo separado, evitando ocupar a capacidade reservada às propostas aprovadas do Bunker.

Os quatro papéis recebem até três exemplos recentes do próprio projeto, com ator, ação, janelas, moedas, métricas e limitações. Casos relevantes, desfavoráveis e inconclusivos têm prioridade. A comparação é revalidada antes de entrar na memória do modelo. Eventos e métricas idênticos não geram casos repetidos; mudanças reais acrescentam evidência. Não há crédito individual, validação retroativa de hipótese nem promoção automática de autonomia financeira.

`plan.learning.automaticHistory` informa cobertura concluída/pendente, ações observadas, comparações e falhas. Essa cobertura é das campanhas priorizadas para leitura profunda: não afirma análise individual de todas as campanhas ou atualização instantânea da origem. Capacidades são explícitas: 3.000 eventos em buffers, 10.000 descritores de mudanças, 5.000 ações, 500 comparações e 1.000 medições externas. Ao atingir um limite, o registro anterior é preservado; não há descarte silencioso. Nenhuma agenda, meta, proteção, segredo, aprovação ou comando financeiro foi alterado por esta etapa.

## Versão 6 — cobertura progressiva e leitura numérica por campanha

Cada coleta escolhe até seis campanhas Meta ativas com gasto: quatro prioridades econômicas e duas com revisão completa mais antiga ou ainda ausente. As duas vagas de rotação vêm primeiro no pacote para sobreviver à redução de contexto. Os IDs ficam congelados no trabalho admitido; créditos de uma etapa não trocam os alvos das etapas seguintes. Um novo trabalho pode escolher outro grupo. Isso amplia a cobertura progressivamente, sem afirmar que toda a conta foi analisada em uma única chamada.

Nas etapas de perspectiva e síntese, o modelo precisa produzir uma leitura curta de cada campanha efetivamente presente no pacote final. Cada leitura identifica conta e campanha, classifica `observe`, `investigate` ou `candidate`, explica o motivo e cita até dois números brutos exatos. Tráfego, orçamento e gestão citam pelo menos um valor disponível; criativos precisa citar um filho quando ele tiver números. Ausência de métricas só permite investigar, sem inventar zeros. O servidor confere os números na geração e novamente nas fontes congeladas antes de registrar a contribuição.

Cada crédito contém autor, mensagem, rodada e hash das fontes. A campanha só entra em cobertura completa depois dos quatro papéis na mesma rodada e fonte. Perguntas, contexto recebido, mensagens antigas sem leitura específica, resposta falha e alvos retirados na redução de contexto não contam. Uma sugestão financeira nova da síntese exige também as três leituras anteriores daquela conta/campanha. Diagnóstico `candidate` não é proposta, aprovação ou execução.

O painel de aprendizado informa quantas campanhas elegíveis já tiveram essa revisão e quantas aguardam. É cobertura histórica, não promessa de leitura atual nem taxa de lucro. No card, o parecer abre no raciocínio da própria campanha, evitando mostrar o resumo de outros alvos. Os pareceres e suas leituras continuam preservados no histórico mesmo após compactação. Capacidades atingidas são sinalizadas sem apagar evidências.

O orçamento de saída das etapas com seis leituras foi elevado para 3.200 tokens, sem criar outra chamada de modelo. Parâmetro e contexto conferidos na [documentação oficial do Workers AI](https://developers.cloudflare.com/workers-ai/models/llama-3.3-70b-instruct-fp8-fast/). Revisões de propostas e respostas pontuais permanecem com o fluxo anterior. Cadência, pausa, metas, proteção de testes e aprovação financeira exata permanecem sob seus controles existentes.

A primeira execução real também revelou um conflito de compatibilidade: a sanitização do histórico retirava `actor.profile`, presente em eventos Meta importados anteriormente. A coleta preserva esse campo, mantendo idêntica a identidade original. Uma divergência verdadeira de evento ou limite de capacidade fica em `historyLearning.failures`, com código e nomes dos campos, sem substituir o evento ou descartar a coleta analítica validada separadamente. Essa campanha não produz comparação de aprendizado enquanto a pendência existir. Só uma coleta posterior consistente limpa a pendência; falha não vira cobertura completa ou exemplo favorável.

## Versão 7 — eficiência e diagnóstico do ciclo autônomo

Uma rodada nova sem campanha Meta ativa com gasto não precisa produzir quatro pareceres vazios. O servidor pode encerrar sua triagem em uma única unidade e sem chamadas de modelo, somente depois de confirmar as doze fontes congeladas, a cobertura operacional completa de hoje, números conhecidos, ausência de reservas/conversas/propostas e ausência de casos medidos que ainda precisem de revisão independente. A decisão é registrada com autor `system`, status `Sem campanhas elegíveis` e etapas `Dispensada`. Não são conclusões de agentes, recomendação de manter, escolha do dono ou crédito de cobertura. Fonte modificada, novo trabalho, dados desconhecidos, pausa ou aprendizado pendente preservam o fluxo normal. A próxima coleta pode encontrar campanhas elegíveis e gerar uma rodada nova.

Falhas de coleta passam a preservar projeto, job, código e etapa (conexão, campanhas, pesquisa, aprendizado ou persistência). A nota fica no job original e no contexto de revisão; o diagnóstico operacional recente mantém até 120 entradas deduplicadas por tentativa. O executor também registra falhas no histórico de atividade, junto da última falha, sem apagá-las quando outra etapa tem sucesso. Corpo de resposta e credenciais não entram nesse diagnóstico. O resumo MCP mostra o motivo da última coleta malsucedida de cada projeto, sem expandir relatórios completos.

O painel distingue explicitamente a triagem do sistema de uma conversa real da equipe. Casos já medidos continuam exigindo revisores reais mesmo quando nenhuma campanha está elegível naquele momento. Não há mudança na agenda, pausa, regras de execução ou aprovação do dono.


## Versão 8 — aproveitar o ecossistema sem perder a evidência

A entrada dos modelos compacta metadados idênticos, colunas repetidas e séries diárias/horárias antes de adiar campanhas. O transporte usa tabelas `columns/v1`, campos constantes e referências explícitas de texto/colunas. Zero, null, campo ausente, valores não arredondados e identidades continuam distintos; a validação usa os campos canônicos, sem alterar as fontes persistidas. O teste de seis campanhas com quatro períodos e hierarquia cabe em 40 KB; isso não garante seis campanhas em todo pacote de produção, nem crédito de revisão para um alvo adiado. O teste também verifica que montar o transporte é puro e repetível.

Cada campanha do pacote final recebe exigências de citação e exemplos numéricos reais. Criativos precisa citar conjunto/anúncio quando há números desses filhos; os demais continuam confrontando seu próprio contexto. As enumerações do esquema usam somente contas e objetos do pacote efetivamente enviado. Exemplo disponível não é análise pronta nem resultado favorável.

Uma tentativa recusada preserva a falha específica (alvo, conta e motivo permitido) e a próxima tentativa do mesmo papel na mesma rodada recebe esse feedback. Número inexistente, citação duplicada ou ausência da evidência exigida continuam impedindo a conclusão. Uma correção válida pode concluir uma única contribuição; falhas não recebem cobertura, aprovação nem pontuação financeira. Outros papéis e rodadas não herdam esse feedback como se fosse próprio.

O contexto de revisão também expõe falhas de ingestão histórica e de comparação retrospectiva, separadas por projeto. O histórico dos gestores alimenta observações; eficácia exige resultados verificáveis e confronto independente. A Órbita continua fornecendo somente metadados criativos quando sua conexão de servidor estiver disponível. Nenhuma fonte ausente recebe sucesso, zeros ou presença simulada. Agenda, pausa, limites e aprovação exata para execução continuam preservados.


## Versão 9 — continuidade com indisponibilidade explícita de campanhas acompanhadas

Um objeto acompanhado pode continuar identificado no detalhe da Malva, mas sem `row` atual. Isso foi observado na conta CA 9289 do Leandro em 05/11: o inventário e a identidade do objeto continuavam acessíveis, enquanto a listagem de hoje e a busca exata não traziam a linha. Isso não comprova exclusão, pausa, orçamento liberado ou resultado zero.

A coleta atualiza as demais campanhas depois de verificar o catálogo completo de ativas e gasto e de consultar cada alvo acompanhado ausente. A exceção exige `row:null` explícito e metadados exatos de plataforma, nível, externalId, número nativo de conta conferido no inventário, moeda e fronteiras do período. Ela é registrada em `analysisScope.unavailableTracked` (ou `coverage` do acompanhamento), com `trackedComplete:false`, identidade e instante da consulta. Divergência de identidade, falha de consulta, truncamento não resolvido ou ausência desses metadados continuam falhando; não são convertidos em indisponibilidade conhecida.

`complete:true` descreve as leituras concluídas dentro do recorte operacional declarado; nunca significa que os objetos de `unavailableTracked` têm dados atuais. Essas identidades não recebem uma linha de desempenho, status ou orçamento inventado. Sua falta de leitura permanece explícita no contexto e na tela. Não entram em seleção de candidatos nem em propostas sem reaparecerem na fonte atual do objeto exato. Totais refletem as linhas retornadas, sem estimar a parcela indisponível. A triagem de rodada vazia não é liberada enquanto houver acompanhamento não resolvido.

O próximo ciclo carrega novamente essas identidades, mesmo que saiam das janelas históricas. Quando a fonte retorna uma linha válida, a lacuna desaparece e somente os novos valores são usados. Fontes congeladas e suas exceções entram na assinatura da rodada; hipótese, parecer, aprovação e aplicação continuam separados. A validação também recusa lacunas duplicadas, misturadas com linhas correntes, marcadas como cobertura completa, com valores financeiros embutidos ou sem identidade anteriormente acompanhada.
