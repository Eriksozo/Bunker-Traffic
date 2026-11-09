# Política de autonomia — fase sombra

Decisão do proprietário em 07/11/2026, depois do estudo das ações de um gestor nos seis projetos Meta. O objetivo é o Bunker agir com precisão antes dos gestores. Este documento descreve a fase atual. Ele **não** autoriza execução automática.

## Estado atual: sombra

- O executor Cloudflare avalia a cada pulso o que cada regra faria e registra a decisão, o primeiro instante em que ela apareceu, os bloqueios e o que um gestor fez depois no mesmo objeto (quem, quando, quantos minutos depois).
- Nada é proposto, aprovado ou enviado ao provedor. Execução continua exigindo proposta exata aprovada pelo proprietário na interface e o fluxo claim → prepare → submit único → confirmação.
- Registro no próprio Durable Object (`shadow:*`, 7 dias, teto de 3.000), fora da central e do Supabase, para não aumentar o volume de gravação do banco.
- Leitura: envelope MCP `cloud-data` com `{"action":"shadow"}` (hoje de cada projeto, pelo fuso do projeto; São Paulo quando nenhum foi avaliado) ou `{"action":"shadow","day":"AAAA-MM-DD"}` para um dia anterior guardado; cada registro traz `owner`, `grade`, `ruleLabel` e limitações. Bloco "Sombra do Bunker · hoje" no app do Mac.
- Duração combinada: 3 a 5 dias, seguida de revisão dos acertos e erros com o proprietário.

## Regras avaliadas

Código: `lib/autonomy-shadow.mjs`. Limiares por projeto ficam na configuração privada `AUTONOMY_SHADOW_POLICY` (secret do Worker), nunca no repositório. Projeto sem configuração não é avaliado.

1. **Pausar campanha nova sem venda** (primeiras 24h e 2º dia; testes e programadas de um dia para o outro): sem front, sem pedidos e sem receita desde o início. Com 0–1 IC vale o teto geral do proprietário de R$110 (pausa a partir de R$99, alerta a partir de R$77); com 2+ IC, o limiar privado do projeto. No 2º dia, venda só de ontem não protege hoje: gasto de hoje sem venda é conferido sozinho contra o mesmo teto (08/11/2026). O mesmo vale quando a venda de um dia anterior está N/D e a de hoje é zero conhecido (registro "venda de ontem N/D, hoje sem venda"). No 2º dia de campanha que começou anteontem, o gasto desde o início soma anteontem (janela fechada de 3 dias) a ontem e hoje; sem essa janela, o registro declara "anteontem não lido" em vez de "desde o início" (correção de 09/11/2026). Detalhes em `first-24h-protocol.md`.
2. **Reduzir em dia ruim** (−20%, ou −30% se o orçamento foi aumentado hoje): campanha com ROI de 3 dias ≥ 1,3, ou campanha de 1 a 3 dias (nunca no dia do lançamento) com ROI de ontem ≥ 1,2 e venda hoje; a partir das 10h, gasto relevante e ROI do dia < 0,9 (ou zero pedidos, só no primeiro caso). Orçamento diário próprio (CBO). ESCALA/COST-CAP/BID-CAP ficam só como sugestão. **Decisão do proprietário de 08/11/2026:** fica só como sugestão até o placar da própria regra (avaliação pelo dia seguinte, janela de 7 dias da sombra) chegar a ≥ 60% de acerto com ≥ 20 decisões avaliadas.
3. **Pausar campanha sem entrega** (organização): sem gasto verificado nos últimos 3 dias e sem impressão hoje, depois das 12h; nunca para campanha nova ou datada de ontem em diante (programada).
4. **Aumentar por vendas desde a meia-noite**: a partir das 9h, ≥ 3 pedidos com ≥ 2 front, ROI parcial ≥ 2,5 e gasto relevante. **Decisão do proprietário de 08/11/2026:** exige histórico de 3 dias com ROI ≥ 1,3 (sem ele, só sugestão); dia forte (ROI do dia ≥ 3) é o gatilho preferencial e leva +50%; os demais casos levam +30%. Sem teto do proprietário por objeto/conta, o aumento nunca executaria. Campanha nova (1º e 2º dia) não precisa de histórico: com ≥ 2 front e ROI parcial ≥ 2 leva +30%, só como sugestão até o placar da regra provar (08/11/2026).
5. **Pausar campanha nova com venda e prejuízo** (1º e 2º dia): vendeu hoje, gasto de hoje ≥ R$300 e ROI de hoje < 0,8 → pausaria; ROI de 0,8 a 1,0 → só alerta.
6. **Aumentar na virada do dia**: das 00:00 às 00:30, campanha de 1 a 4 dias cujo ontem teve ≥ 1 front e ROI ≥ 1,3 → +100% em orçamento abaixo de R$1.000, +30% acima (+50% com ROI de ontem ≥ 2). Antes da primeira análise do dia, "ontem" é o último corte da análise de ontem, declarado no registro. Orçamento em reais N/D (moeda estrangeira sem taxa) não é avaliado: sem tamanho conhecido não há "pequeno" nem "grande". Só sugestão até o placar provar; o placar desta regra é o próprio dia D (o dia em que o aumento age), não D+1. **Pendente de confirmação do proprietário:** a base D veio de uma correção técnica de 09/11/2026 e não de decisão dele; antes de usar `scoreGate('night-increase')` para promover a regra, o proprietário confirma essa base. Decisões já avaliadas por D+1 antes da correção são reavaliadas por D quando a leitura de D existe; sem ela, perdem o veredito.

Bloqueios comuns: fonte de hoje com mais de 30 minutos ou de outro dia local (depois da meia-noite, o corte de ontem não é "hoje"; serve só como "ontem" da regra 6 e do 2º dia da regra 1, declarado no registro), conta ou campanha inativa, aquecimento/engajamento, edição de outro gestor nas últimas 2h. Limitações declaradas em cada registro: pedidos pendentes e vendas em hora sem gasto não são verificados pela fonte de campanhas.

Uma pausa registrada no mesmo pulso para o mesmo objeto prevalece: o aumento (regras 4 e 6) fica bloqueado com o motivo. Valor ausente aparece como N/D, nunca 0 ou "null".

## Placar e reação dos gestores

- Cada decisão é avaliada pelo dia seguinte (D+1): corte certo quando D+1 deu prejuízo, aumento certo quando deu lucro; sem gasto em D+1 é "parou". A regra 6 é avaliada pelo próprio D. Gasto N/D é "N/D" e fica aberto para uma leitura completa posterior.
- Alerta sem pausa (regra 5 de 0,8 a 1,0) não é corte: não entra no placar nem em "cortes em vencedores", inclusive quando já tinha nota gravada antes da correção.
- O que o próprio proprietário fez (pelo Bunker ou informado com "Já fiz no Gerenciador") conta como do proprietário, nunca como reação de gestor. Uma edição de gestor desfeita antes da decisão (pausou e reativou) não conta como reação.

## Decisões do proprietário para a fase de execução

- Regras elegíveis: as quatro originais, incluindo o padrão de aumento, com teto. As regras 5 e 6 (08/11/2026) seguem a mesma revisão antes de qualquer execução.
- Sem limite diário de ações por projeto; o proprietário acompanha as decisões junto com o Bunker.
- O Bunker cuida dos testes no 1º e 2º dia. Avisos vão somente ao proprietário.

## Para ligar a execução (pendente)

1. Revisão da sombra com o proprietário: acertos, pausas que teriam cortado vencedores, aumentos que teriam piorado e antecedência real sobre os gestores.
2. Tetos de orçamento definidos pelo proprietário por objeto e por conta.
3. Registro explícito do proprietário mudando a regra de execução no `CLAUDE.md`, com as regras habilitadas e um desligamento geral.
4. Implementação revisada: a execução continua usando claim → prepare → submit único → confirmação, com releitura da última edição imediatamente antes do envio.

## Ajuste das regras pelo backtest (08/11/2026)

O proprietário aprovou ("Aplicar agora") três ajustes, apoiados no backtest de séries diárias reais (dados fora do repositório): um único dia ruim só antecipou dia seguinte negativo em cerca de um terço dos casos; dia forte (ROI ≥ 3, ≥ 3 pedidos) teve dia seguinte positivo em ~76%; aumento com ROI de 3 dias ≥ 1,3 acertou ~69%. As regras continuam em fase sombra: nada executa. Constantes em `shadowRulePolicy` (`lib/autonomy-shadow.mjs`).

## Regras de 08/11/2026, a partir dos gestores ("Aplicar as 4")

Relato do proprietário: um gestor agiu antes do Bunker, e "nunca pode fazer primeiro". Estudo somente leitura das pausas de campanhas novas com venda (03 a 08/11) e de ~285 edições de orçamento de um gestor (01 a 08/11), com dados fora do repositório:

- Campanha nova que vendeu com ROI < 0,8 quase nunca virou lucro no dia seguinte (2 de 20); de 0,8 a 1,0 recuperou com frequência; de 1,0 a 1,3, cerca de metade. O corte típico dos gestores é 1 front com R$350–500 gastos.
- Os aumentos do gestor saem em lotes (≈09h–10h, ≈13h–15h e, uma vez, logo depois da meia-noite pelo ontem fechado), com passo mediano de +50%; só ~40% fecharam o dia seguinte com ROI ≥ 1,2. As reduções são de −20% ou −30% com o ROI de hoje < 1, mesmo com ontem bom.

Por isso só a regra 5 (pausa abaixo de 0,8) pode marcar "executaria". As regras de orçamento (2, 4 em campanha nova, 6) ficam como sugestão até o próprio placar passar de 60% com 20+ avaliações (`scoreGatedRules`). Nada executa: a fase continua sombra. Testes: `tests/shadow-four-rules.test.mjs`.
