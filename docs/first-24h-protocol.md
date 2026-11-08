# Protocolo das primeiras 24h de campanhas novas Meta

Decisão do proprietário em 07/11/2026. Campanhas novas — testes `[TESTE]` e também as programadas de um dia para o outro (`[PRE]`, `[COSTCAP]`, `[RETESTE]`, etc.) — recebem acompanhamento próprio nas primeiras 24h. Este protocolo complementa `test-launch-protocol.md` e a fase sombra (`autonomy-policy.md`). Ele **não** autoriza execução: pausa continua exigindo proposta exata aprovada pelo proprietário e o fluxo claim → prepare → submit único → confirmação.

Código: `lib/first-24h.mjs` (identificação e teto), `lib/autonomy-shadow.mjs` (regra da sombra e painel), `lib/campaign-watch.mjs` (sinal `first-24h`).

## Identificar

A Malva hoje não envia início programado nem início de entrega (`startAt`/`deliveryStartedAt` vazios em todas as campanhas lidas em 07/11). A identificação usa o que existe, nesta ordem:

| Estágio | Quando |
| --- | --- |
| **Programada** | Sem gasto e sem impressão, sem gasto em 7d/3d/ontem, e data no nome de amanhã até 14 dias à frente (ou início programado futuro, se a fonte passar a enviar). |
| **Primeiras 24h** (1º dia) | Sem gasto anterior observado e: nomeada para hoje; nomeada para ontem com ontem sem gasto verificado (programada que começou tarde); ou teste `[TESTE]` com as três janelas fechadas comprovadamente zeradas. Nomeada para hoje e ainda sem entrega aparece como "aguardando entrega". |
| **2º dia** | Primeiro gasto ontem (7d = 3d = ontem), em teste ou em campanha nomeada nos últimos 2 dias. |

- Gasto anterior em qualquer janela sempre vence a data do nome (campanha renomeada não vira nova).
- Fora de testes, campanha com data no nome de mais de 2 dias atrás não é nova, mesmo reativada.
- Aquecimento/engajamento, Kwai e projetos fora dos seis configurados ficam fora.
- Unidade: projeto + conta + ID da campanha.

## Teto das primeiras 24h

Regra geral do proprietário: campanha nova **sem venda** e com **0 ou 1 IC** não pode gastar **R$110**.

| Situação (gasto desde o início: hoje, ou ontem + hoje no 2º dia) | Nível |
| --- | --- |
| Gasto < 70% do teto (< R$77) | acompanhar |
| ≥ 70% (R$77) | perto do teto (alerta) |
| ≥ 90% (R$99) | pausaria — a sombra registra pausa antes de cruzar o teto, porque o próximo pulso pode chegar tarde |
| ≥ 100% (R$110) | teto estourado |
| Qualquer venda (front, pedido ou receita) | com venda: segue o acompanhamento normal |
| 2+ IC e 0 venda | limiar privado do projeto (`pauseTestMinSpend`), pausa no próprio limiar |

- A política privada `AUTONOMY_SHADOW_POLICY` pode **reduzir** o teto por projeto (`first24hLowIcLimit`, ou `pauseTestMinSpendNoCheckout` para 0 IC); nunca subir acima de R$110.
- IC não informado pela fonte: o teto aparece, mas a decisão fica bloqueada até conferir. Vendas não informadas ficam N/D, nunca zero.
- O valor é em reais, como o gasto da fonte de campanhas.

## Onde aparece

- **Sombra do Bunk** (regra `test-no-sale`, agora "Pausar campanha nova sem venda (primeiras 24h e 2º dia)"): registra o que faria e se o gestor agiu depois. Não executa.
- **Notch / app do Mac**: bloco "Primeiras 24h" com as campanhas no 1º e 2º dia (mais urgentes primeiro) e as programadas; o Bunk avisa quando alguma está perto do teto.
- **Acompanhamento de campanhas**: sinal `first-24h` (prioridade 1) em "perto do teto" ou acima; contagem `newCampaigns` por projeto.
- Leitura MCP `cloud-data` `{"action":"shadow"}` devolve também `first24h.boards`.

## Correção de 07/11

A regra "Pausar campanha sem entrega" reconhecia só datas de hoje e ontem. Campanhas programadas para amanhã (`08/11 - ...`) apareciam como pausáveis. Agora qualquer campanha nova ou datada de ontem em diante nunca entra nessa regra.

## Limites declarados

- Sem início real de entrega, "24h" é aproximado pelo dia do primeiro gasto e pela data do nome; uma campanha que começou às 22h de ontem é tratada como 2º dia hoje, com o gasto somado desde o início.
- Sem detalhe por hora e com atribuição que pode atrasar, um IC ou venda pode chegar depois da leitura.
- Nada aqui muda cadência, fuso, pausa, metas ou limites do executor.
