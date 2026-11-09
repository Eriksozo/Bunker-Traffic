# Protocolo das primeiras 24h de campanhas novas Meta

Decisão do proprietário em 07/11/2026. Campanhas novas — testes `[TESTE]` e também as programadas de um dia para o outro (`[PRE]`, `[COSTCAP]`, `[RETESTE]`, etc.) — recebem acompanhamento próprio nas primeiras 24h. Este protocolo complementa `test-launch-protocol.md` e a fase sombra (`autonomy-policy.md`). Ele **não** autoriza execução: pausa continua exigindo proposta exata aprovada pelo proprietário e o fluxo claim → prepare → submit único → confirmação.

Código: `lib/first-24h.mjs` (identificação e teto), `lib/autonomy-shadow.mjs` (regra da sombra e painel), `lib/campaign-watch.mjs` (sinal `first-24h`).

## Identificar

A Malva não envia início programado nem início de entrega (`startAt`/`deliveryStartedAt` vazios em todas as campanhas lidas em 07/11). Desde 08/11 a leitura Meta ao vivo (`docs/connections.md`) traz `start_time`/`created_time`: com ela, a contagem das 24h começa no início real (o mais tarde dos dois), e uma campanha renomeada com início antigo não vira nova. Sem leitura Meta recente, vale a dedução pelo nome e pelo histórico:

| Estágio | Quando |
| --- | --- |
| **Programada** | Sem gasto e sem impressão, sem gasto em 7d/3d/ontem, e data no nome de amanhã até 14 dias à frente (ou início programado futuro, se a fonte passar a enviar). Com início real da Meta já passado, a data do nome não torna a campanha programada. |
| **Primeiras 24h** (1º dia) | Sem gasto anterior observado e: nomeada para hoje; nomeada para ontem com ontem sem gasto verificado (programada que começou tarde); ou teste `[TESTE]` com as três janelas fechadas comprovadamente zeradas. Nomeada para hoje e ainda sem entrega aparece como "aguardando entrega". |
| **2º dia** | Primeiro gasto ontem (7d = 3d = ontem), em teste ou em campanha nomeada nos últimos 2 dias. |

- Gasto anterior em qualquer janela sempre vence a data do nome (campanha renomeada não vira nova).
- Fora de testes, campanha com data no nome de mais de 2 dias atrás não é nova, mesmo reativada.
- Data do nome sem ano: vale o ano mais recente que não passe de 60 dias à frente. Uma data além disso é do ano anterior (em 09/11, `01/05` é 192 dias atrás, não daqui a 173). Até 60 dias à frente o nome segue lido como datado à frente (em 09/11, `29/11` é daqui a 20 dias), e a regra de campanha sem entrega não o trata como pausa organizacional; só programa pelo nome até 14 dias à frente.
- Aquecimento/engajamento, Kwai e projetos fora dos seis configurados ficam fora.
- Unidade: projeto + conta + ID da campanha.

## Teto das primeiras 24h

Regra geral do proprietário: campanha nova **sem venda** e com **0 ou 1 IC** não pode gastar **R$110**.

| Situação (gasto desde o início: hoje, ou ontem + hoje no 2º dia; anteontem também, pela janela de 3 dias fechados, quando a campanha começou anteontem) | Nível |
| --- | --- |
| Gasto < 70% do teto (< R$77) | acompanhar |
| ≥ 70% (R$77) | perto do teto (alerta) |
| ≥ 90% (R$99) | pausaria — a sombra registra pausa antes de cruzar o teto, porque o próximo pulso pode chegar tarde |
| ≥ 100% (R$110) | teto estourado |
| Qualquer venda (front, pedido ou receita) | com venda: segue o acompanhamento normal |
| 2+ IC e 0 venda | limiar privado do projeto (`pauseTestMinSpend`), pausa no próprio limiar |

- **2º dia depois de um 1º dia com venda** (relato do proprietário, 08/11/2026): a venda de ontem não cobre o gasto de hoje. Se hoje há gasto e nenhuma venda, o gasto de **hoje** é conferido contra o mesmo teto (R$110 com 0–1 IC de hoje; limiar do projeto com 2+ IC). O mesmo vale quando a venda de ontem está N/D e a de hoje é zero conhecido. Depois da meia-noite, antes da primeira análise do dia, o 2º dia usa o último corte da análise de ontem como "ontem", declarado no registro. Antes, a venda de ontem deixava a campanha como "com venda" o dia inteiro, e um gestor pausou seis testes desse tipo sem registro prévio da sombra.
- A política privada `AUTONOMY_SHADOW_POLICY` pode **reduzir** o teto por projeto (`first24hLowIcLimit`, ou `pauseTestMinSpendNoCheckout` para 0 IC); nunca subir acima de R$110.
- IC não informado pela fonte: o teto aparece, mas a decisão fica bloqueada até conferir. Vendas não informadas ficam N/D, nunca zero.
- Basta um campo de venda conhecido e positivo (front, pedido ou receita) para "com venda", mesmo com outro campo N/D. "0 venda" exige os três conhecidos; sem venda positiva e com algum campo N/D, fica "venda N/D". Gasto não informado aparece como "gasto N/D".
- O texto do teto diz a base real: "com 0 IC" quando o limite menor para 0 IC (`pauseTestMinSpendNoCheckout`) está valendo; "com até 1 IC" nos demais casos.
- O valor é em reais, como o gasto da fonte de campanhas.

## Onde aparece

- **Sombra do Bunk** (regra `test-no-sale`, agora "Pausar campanha nova sem venda (primeiras 24h e 2º dia)"): registra o que faria e se o gestor agiu depois. Não executa.
- **Notch / app do Mac**: bloco "Primeiras 24h" com as campanhas no 1º e 2º dia (mais urgentes primeiro) e as programadas; o Bunk avisa quando alguma está perto do teto.
- **Acompanhamento de campanhas**: sinal `first-24h` (prioridade 1) em "perto do teto" ou acima; contagem `newCampaigns` por projeto.
- Leitura MCP `cloud-data` `{"action":"shadow"}` (ou com `"day":"AAAA-MM-DD"`) devolve também `first24h.boards`.

## Correção de 07/11

A regra "Pausar campanha sem entrega" reconhecia só datas de hoje e ontem. Campanhas programadas para amanhã (`08/11 - ...`) apareciam como pausáveis. Agora qualquer campanha nova ou datada de ontem em diante nunca entra nessa regra.

## Limites declarados

- Com a leitura Meta, as 24h contam do início programado/criação; a Meta não informa o primeiro instante de entrega, então uma campanha aprovada com atraso tem a contagem antecipada. Sem a leitura Meta, "24h" é aproximado pelo dia do primeiro gasto e pela data do nome.
- Gasto ao vivo da Meta: só quando a conta está no mesmo dia local do projeto e a taxa de conversão da campanha é conhecida.
- Sem detalhe por hora e com atribuição que pode atrasar, um IC ou venda pode chegar depois da leitura.
- Nada aqui muda cadência, fuso, pausa, metas ou limites do executor.
