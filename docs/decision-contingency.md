# Contingência da decisão

O card mostra Antes, Durante e Depois. `plan.contingency` entrega o mesmo contexto ao executor, com exposição por projeto e conferências pós-aplicação. É proteção do fluxo Bunker; não instala regra de gasto na Meta nem garante que campanhas parem quando o Mac, o Codex ou as fontes estiverem indisponíveis.

## Antes

1. Releitura atual, quatro períodos, hierarquia, identidade e moeda exatas continuam obrigatórios pelo protocolo de aprovação. Cache atual pode vetar uma decisão; não pode autorizar execução.
2. Calcular gasto observado, diário ativo identificado, reservas de aumentos pendentes e o efeito da ação pretendida. Considerar todos os custos Meta do recorte, incluindo aquecimento. Não somar orçamento CBO com filhos; se ABO, moeda/cotação, status ou escopo estiverem incompletos, informar exposição parcial. Equivalência BRL de orçamento nativo usa somente cotação explicitamente fornecida.
3. Reservar o maior aumento pendente por proprietário financeiro, evitando duplicar versões. Reduções prometidas não liberam saldo. Uma aplicação ambígua já visível na fonte não é somada novamente ao orçamento observado.
4. `dailyCap` é teto diário autorizado do projeto; verificar gasto alcançado e diário identificado com reservas/ação. Fonte financeira precisa de coleta até cinco minutos e relógio Malva conhecido de até 15 minutos. Se o teto estiver configurado e exposição/gasto não puderem ser conciliados, bloquear ampliação.
5. `lossCap` mantém sua definição existente: perda da rodada. Calcular deterioração líquida entre a leitura de hoje da rodada e a leitura atual apenas com mesma janela, fuso e conjunto exato de identidades, sem preencher ausência com zero. Não comparar automaticamente o prejuízo total do dia com esse limite. Falta de comparação vira N/D e bloqueia ampliação quando esse limite está configurado.
6. Incidente/retomada bloqueia aumento ou reativação no escopo afetado. Pausa/redução continua possível com nova aprovação e fontes exigidas, sem violar trava de execução em andamento.

Nenhum valor é inventado: limites `null` continuam não definidos e ficam visíveis. Zero explicitamente configurado é limite zero. Sem limites numéricos, proteções técnicas continuam funcionando, mas não existe um bloqueio financeiro por valor. O sistema não modifica metas, caps ou proteções do cliente automaticamente.

## Durante

- A reserva é por proprietário financeiro: CBO da campanha, ABO do conjunto, ou pai selado de uma reativação. Filhos distintos que compartilham orçamento não podem despachar alterações concorrentes. Projeto, provedor e conta fazem parte da identidade.
- Conferir versão assinada/aprovação exata, moeda, orçamento/status anterior, UUID interno e pai financeiro. Reavaliar contingência no servidor ao aprovar e antes de preparar/enviar. Locks são conferidos novamente no journal de execução; CAS da central protege concorrência.
- Executar exclusivamente o comando exato de `prepare` e apenas se a primeira resposta persistida de `submit` conceder `dispatchGranted:true`. Timeout/envio ambíguo mantém trava de conferência, inclusive após o lease vencer. Não reenviar.
- Confirmar por nova leitura do objeto e proprietário selados. Pausa, teto estourado ou fonte substituída não impedem readback de um envio anterior. Falha de cache agregado não impede preparar/enviar uma contenção já aprovada, desde que a leitura direta obrigatória e os demais controles sejam válidos.
- Nova escala/reativação no mesmo proprietário aguarda 60 minutos após confirmação. Nova contenção pode ser analisada antes disso, com outra proposta/aprovação e dados novos. A janela de observação é técnica, não um percentual financeiro automático.

## Depois

Preparação e confirmação podem guardar baseline financeiro opcional: `observation.metricsCurrency = BRL`, `from`, `to`, `timezone` e valores normalizados realmente retornados da linha exata. Moeda de métricas é separada da moeda do orçamento. Sem isso, desempenho posterior fica N/D; a aplicação financeira ainda precisa de confirmação nativa exata.

Após `Confirmada`, a fila oferece conferências de 15, 30 e 60 minutos. Somente uma revisão de cada etapa, em ordem, com leitura fresca realmente mais nova. Atrasos preservam o horário real e `lateByMs`; não simular observações nos horários perdidos. Deltas mostram gasto, líquido, front, pedidos, checkouts e resultado novos desde o readback comparável. Janelas/moeda divergentes, redução de acumulados, baseline ausente ou nova alteração nativa produzem N/D. Correlação temporal não comprova efeito causal, atribuição imediata nem ausência de novos custos.

`plan.autonomous` inclui `followUp` depois de verificações de envios e antes de novas execuções. `cacheRead` usa o envelope somente leitura `contingency-data`, que retorna uma observação do alvo exato. Campanhas usam o cache atual; conjuntos/anúncios podem usar uma leitura atual de hoje já coletada na cadência. Sem fonte nova, a revisão aguarda; não iniciar coleta fora da agenda para preenchê-la. A rotina local precisa estar ativa; painel e fila não provam presença online.

Registrar pelo MCP de colaboração:

```json
{"action":"executionMonitor","id":"ID_REAL_DA_EXECUCAO","entry":{"checkpointMinutes":15},"observation":{},"clientId":"ID_UNICO","executionRef":"REFERENCIA_REAL_DO_TRABALHADOR"}
```

Preencher `observation` somente com a leitura real. Clientes antigos usam `bunker_atualizar_rodada`, revisão central atual, id `collaboration`, status `Pendente`, e `note` com esse JSON. Monitoramento grava apenas evidência no Bunker: não contém comando financeiro ou aprovação. `clientId` é imutável/idempotente; não repetir gravação cegamente após uma resposta perdida.

Se houver perda, divergência ou risco, priorizar reavaliação e preparar contenção/reversão com valores atuais. Reversão exige nova proposta, pareceres, aprovação exata e envio único. Nunca reaplicar automaticamente o valor anterior: ele pode estar vencido ou ter sido alterado por outro gestor. Previsões experimentais não são gatilhos de orçamento.
