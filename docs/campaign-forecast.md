# Tendência e cenários nos cards

O Kanban informa o contraste da aquisição nos últimos três dias fechados com os quatro dias anteriores. O modal inclui cenários conservador, central e favorável, alimentados pela série diária da campanha exata. É apoio visual e não altera análise selada, recomendações, intenção do dono, aprovação ou execução.

## Tendência da aquisição

Usar apenas janelas de sete e três dias com mesmo fim/fuso e fronteiras civis válidas. Subtrair gasto e vendas front de 3d dos valores de 7d, obtendo o bloco anterior de quatro dias, em vez de somar janelas sobrepostas. Exigir pelo menos cinco front em cada bloco. Variação do CPA Front de até 15% para cima ou para baixo é apresentada como estabilidade; além disso, melhora ou encarecimento. Este limiar descreve o histórico; não é teste de significância nem regra financeira de pausa/escala. A data da análise permanece visível. Análise vencida no Kanban aparece como releitura pendente.

## Cenários de fechamento `conditional-pacing-v1`

- Série Malva com identidade exata de projeto/conta/campanha, moeda BRL, fuso confirmado e coleta de até cinco minutos. Status nativo também precisa de acompanhamento recente e ativo.
- Mínimo de três horas do dia, três dias anteriores com gasto e dez pedidos no histórico. Gasto parcial deve atingir 10% da mediana do gasto diário histórico. Dias sem dados não viram zeros; dias sem gasto não são referências de eficiência.
- O gasto restante é uma extrapolação linear do ritmo observado na coleta até o limite real do dia do projeto. Não usa o relógio do navegador como se novas vendas tivessem ocorrido nem supõe que o orçamento será integralmente entregue. Mudanças de ritmo por horário não são modeladas.
- Referências históricas são dias próximos dos quantis empíricos 20/50/80 de resultado por real investido. Receita, resultado e pedidos permanecem pareados no dia de referência; os cenários são ordenados pelo resultado financeiro, não por cada métrica individual.
- A taxa de cada exemplo histórico é combinada com a taxa observada hoje. Peso do parcial = gasto hoje / (gasto hoje + mediana do gasto diário / 4), limitado entre 25% e 75%. O realizado de hoje é preservado; só o gasto restante é simulado. Receita/gasto produz ROAS; ROI não é inferido de lucro porque os custos separados não estão na série diária.
- Pedidos incluem upsells. Não há previsão numérica de vendas front ou compradores a partir desses pedidos.

Uma alteração observada há menos de 60 minutos, divergência nativa ainda sem conciliação, incidente/retomada em acompanhamento, pausa, falha de fonte, moeda/fuso divergentes, datas inválidas, duplicadas ou outro dia suspendem o cálculo. Exibir motivo explícito e N/D, sem reciclar números antigos.

## Limites de interpretação

São cenários heurísticos condicionais, não intervalos estatísticos de previsão, nem probabilidades ou efeitos causais de mudanças de orçamento. O modelo não recebeu treinamento ou backtest intradiário. A confiança é sempre limitada/experimental; não existe percentual de precisão confirmado. O horário da coleta da série é mostrado; se a fonte não informa o próprio relógio de sincronização, essa limitação fica explícita. Validar com previsões congeladas prospectivamente e fechamentos posteriores antes de alegar calibração. Não usar a simulação para aprovar ou executar orçamento.
