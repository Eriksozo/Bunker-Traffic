# Política de autonomia — fase sombra

Decisão do proprietário em 07/11/2026, depois do estudo das ações de um gestor nos seis projetos Meta. O objetivo é o Bunker agir com precisão antes dos gestores. Este documento descreve a fase atual. Ele **não** autoriza execução automática.

## Estado atual: sombra

- O executor Cloudflare avalia a cada pulso o que cada regra faria e registra a decisão, o primeiro instante em que ela apareceu, os bloqueios e o que um gestor fez depois no mesmo objeto (quem, quando, quantos minutos depois).
- Nada é proposto, aprovado ou enviado ao provedor. Execução continua exigindo proposta exata aprovada pelo proprietário na interface e o fluxo claim → prepare → submit único → confirmação.
- Registro no próprio Durable Object (`shadow:*`, 7 dias, teto de 3.000), fora da central e do Supabase, para não aumentar o volume de gravação do banco.
- Leitura: envelope MCP `cloud-data` com `{"action":"shadow"}` e bloco "Sombra do Bunker · hoje" no app do Mac.
- Duração combinada: 3 a 5 dias, seguida de revisão dos acertos e erros com o proprietário.

## Regras avaliadas

Código: `lib/autonomy-shadow.mjs`. Limiares por projeto ficam na configuração privada `AUTONOMY_SHADOW_POLICY` (secret do Worker), nunca no repositório. Projeto sem configuração não é avaliado.

1. **Pausar campanha nova sem venda** (primeiras 24h e 2º dia; testes e programadas de um dia para o outro): sem front, sem pedidos e sem receita desde o início. Com 0–1 IC vale o teto geral do proprietário de R$110 (pausa a partir de R$99, alerta a partir de R$77); com 2+ IC, o limiar privado do projeto. No 2º dia, venda só de ontem não protege hoje: gasto de hoje sem venda é conferido sozinho contra o mesmo teto (08/11/2026). Detalhes em `first-24h-protocol.md`.
2. **Reduzir 20% em dia ruim**: campanha com ROI de 3 dias ≥ 1,3, a partir das 10h, gasto relevante e ROI do dia < 0,7 ou zero pedidos. Orçamento diário próprio (CBO). ESCALA/COST-CAP/BID-CAP ficam só como sugestão. **Decisão do proprietário de 08/11/2026:** fica só como sugestão até o placar da própria regra (avaliação pelo dia seguinte, janela de 7 dias da sombra) chegar a ≥ 60% de acerto com ≥ 20 decisões avaliadas.
3. **Pausar campanha sem entrega** (organização): sem gasto verificado nos últimos 3 dias e sem impressão hoje, depois das 12h; nunca para campanha nova ou datada de ontem em diante (programada).
4. **Aumentar por vendas desde a meia-noite**: a partir das 9h, ≥ 3 pedidos com ≥ 2 front, ROI parcial ≥ 2,5 e gasto relevante. **Decisão do proprietário de 08/11/2026:** exige histórico de 3 dias com ROI ≥ 1,3 (sem ele, só sugestão); dia forte (ROI do dia ≥ 3) é o gatilho preferencial e leva +50%; os demais casos levam +30%. Sem teto do proprietário por objeto/conta, o aumento nunca executaria.

Bloqueios comuns: fonte de hoje com mais de 30 minutos, conta ou campanha inativa, aquecimento/engajamento, edição de outro gestor nas últimas 2h. Limitações declaradas em cada registro: pedidos pendentes e vendas em hora sem gasto não são verificados pela fonte de campanhas.

## Decisões do proprietário para a fase de execução

- Regras elegíveis: as quatro acima, incluindo o padrão de aumento, com teto.
- Sem limite diário de ações por projeto; o proprietário acompanha as decisões junto com o Bunker.
- O Bunker cuida dos testes no 1º e 2º dia. Avisos vão somente ao proprietário.

## Para ligar a execução (pendente)

1. Revisão da sombra com o proprietário: acertos, pausas que teriam cortado vencedores, aumentos que teriam piorado e antecedência real sobre os gestores.
2. Tetos de orçamento definidos pelo proprietário por objeto e por conta.
3. Registro explícito do proprietário mudando a regra de execução no `CLAUDE.md`, com as regras habilitadas e um desligamento geral.
4. Implementação revisada: a execução continua usando claim → prepare → submit único → confirmação, com releitura da última edição imediatamente antes do envio.

## Ajuste das regras pelo backtest (08/11/2026)

O proprietário aprovou ("Aplicar agora") três ajustes, apoiados no backtest de séries diárias reais (dados fora do repositório): um único dia ruim só antecipou dia seguinte negativo em cerca de um terço dos casos; dia forte (ROI ≥ 3, ≥ 3 pedidos) teve dia seguinte positivo em ~76%; aumento com ROI de 3 dias ≥ 1,3 acertou ~69%. As regras continuam em fase sombra: nada executa. Constantes em `shadowRulePolicy` (`lib/autonomy-shadow.mjs`).
