# Protocolo de lançamento de testes Meta

Objetivo: não deixar testes novos com gasto e sem aquisição fora do acompanhamento por uma espera automática de 24h. Este protocolo muda triagem e prioridade; não concede autonomia financeira nem altera a cadência.

## Identificar sem adivinhar

- Unidade: projeto + conta + ID de campanha. Mesmo nome em outra conta é outro resultado.
- Apenas fase Teste. Aquecimento, Avatar e campanhas de escala seguem seus próprios contextos.
- Conferir entrega real e início programado quando disponíveis. Data no nome é apenas indicação, nunca prova de criação ou programação noturna.
- Gasto em alguma janela anterior ou entrega antiga impedem classificar a campanha como primeiro dia apenas por ter sido renomeada.
- Três janelas fechadas com zero gasto observado podem apoiar a classificação provisória de primeiro gasto. As janelas se sobrepõem e não são três experimentos independentes. As janelas fechadas são coletadas só com linhas que gastaram; a ausência do mesmo projeto + conta + ID numa fonte Malva completa, única, que termina onde hoje começa e foi lida e sincronizada depois disso, conta como gasto não observado (`verifiedNoSpendPeriods`). Qualquer outra ausência (dia anterior, fonte incompleta, duplicada ou sem sincronização) continua N/D. Isso cobre o teste nomeado na véspera e programado para hoje.

## Antes e desde o primeiro gasto

1. Na cadência configurada, reconciliar as campanhas ativas, com gasto e já acompanhadas. Conferir horário da origem e cobertura; leitura incompleta não significa que não há testes.
2. Teste novo com gasto e zero front, pedidos e receita recebe sinal de revisão prioritária. Esse sinal aparece mesmo com a análise anterior vencida, explicitando a necessidade de reler os quatro períodos.
3. O resumo deixa esses testes acessíveis, em vez de escondê-los como protegidos. O motor reserva até duas posições prioritárias por unidade de análise para eles, preservando duas posições de rotação. Mais de seis campanhas exige outras unidades; não alegar revisão individual de toda a fila.
4. Aquisição nova ou correção de atribuição muda a classificação na leitura seguinte. Campanhas já pausadas ou contas sem aptidão ficam fora da fila de intervenção ativa.

## Decidir

Conferir 7d/3d fechados, ontem, hoje, diário/horário, checkout, atribuição e última edição; descer aos conjuntos/anúncios. Um teste novo pode ter janelas anteriores realmente zeradas. Isso não exige esperar outro dia para avaliar o risco atual.

Usar o histórico nominal dos gestores no aprendizado privado do próprio projeto para comparar gasto, aquisição, horário e contexto das pausas e dos aumentos. A ação registrada não revela sozinha a intenção do gestor ou sua eficácia. Métricas relidas depois da pausa podem ter mudado por sincronização ou atribuição e não são o retrato exato da decisão.

- Sem aquisição e com exposição material: avaliar pausa ou contenção fundamentada, sem proteção automática de 24h.
- Com aquisição: conferir se ela paga o teste e se é recorrente. Uma venda isolada não obriga manter; outra cópia vencedora não justifica manter esta.
- Histórico rentável e dia parcial ruim: separar esse caso do lançamento sem validação; observar ou conter conforme contexto, sem pausa pelo dia isolado.
- Fonte antiga, identidade ambígua ou incidente: destacar a lacuna e conferir; nunca preencher com zero ou culpar automaticamente o criativo.

Nenhum valor universal é inferido de exemplos de pausa. Referências financeiras permanecem no aprendizado privado de cada projeto, sem copiar metas entre clientes.

## Aplicar e acompanhar

Sugestão no card → aprovação do dono da proposta exata → claim/prepare/submit uma vez → releitura e confirmação. Intenção ou exemplo histórico não equivale a aprovação. Mudança externa exige releitura antes de repetir ajuste. Pausadas não são reativadas automaticamente.

Após a ação, conferir status efetivo, orçamento próprio/pai, histórico e novos resultados, preservando tentativas e falhas. Nenhuma mudança deste protocolo altera cron, fuso, pausa ou limites existentes. A velocidade depende da origem e da fila; não há garantia de atualização instantânea ou prejuízo zero.
