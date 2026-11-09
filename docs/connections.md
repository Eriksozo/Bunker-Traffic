# Conexões e publicação

O destino principal é Cloudflare Workers + Supabase Postgres. GitHub versiona o código; A Malva usa uma chave MCP de servidor dedicada; o executor e o modelo rodam na Cloudflare. A Órbita usa a Edge Function de servidor `orbita-mcp`, sem depender da sessão do Mac. Conexão técnica não concede autorização para mudar anúncios.

## Caminhos

- Interface: `https://bunker-traffic.erik-iplou.workers.dev`.
- Login: Supabase Auth, link de e-mail, proprietário definido em `BUNKER_OWNER_EMAIL`. Cookies HttpOnly, Secure e SameSite; cabeçalhos de identidade recebidos do visitante são removidos antes da autenticação.
- Entrada direta opcional: `BUNKER_DIRECT_ACCESS_URL` aponta para a raiz HTTPS do Site privado já autenticado no ChatGPT. Visitantes sem sessão Supabase que chegam ao login são encaminhados para essa interface, ligada à mesma base. Isso não transfere cookies, não cria uma sessão Supabase nem libera APIs anônimas. Preserve o Site com acesso exclusivo do proprietário. O login Supabase por e-mail continua disponível em `/auth/login?email=1`.
- Banco: Postgres, tabelas `bunker_records` e `bunker_reports`, com RLS e sem concessões a anon/authenticated. A função `bunker_store` é SECURITY INVOKER e exclusiva do backend service_role.
- Agentes: o MCP privado existente no Sites permanece como compatibilidade autenticada. Seu armazenamento usa o gateway privado `/internal/storage` do Worker, portanto a interface nova e os agentes acessam a mesma base Supabase.
- Malva: secret `MALVA_MCP` no Supabase, Edge Function `malva-mcp` com autenticação de serviço. Somente ferramentas explicitamente permitidas. Chave pessoal MCP, não a chave REST de relatórios.
- Órbita: secret `Orbita_token` no Supabase e função `orbita-mcp` com autenticação de serviço. Somente identidade, cadastros, produções e lateralizações. Durante etapas elegíveis de análise, o executor atualiza metadados do projeto no máximo uma vez por minuto; exige mesmo e-mail proprietário/Malva, workspace esperado e expert único. Nenhum token do desktop é copiado. Cobertura é somente dos registros retornados (até 100 produções e 100 lateralizações); a consulta não prova entrega Meta nem resultado financeiro. Falha preserva a fonte anterior e fica explícita nos pacotes dos agentes.

## Segredos

Configure em produção: `SUPABASE_URL`, `SUPABASE_ANON_KEY` (publishable), `SUPABASE_SERVICE_ROLE_KEY` (secret de backend), `BUNKER_OWNER_EMAIL`, `BUNKER_AGENT_TOKEN` e `BUNKER_STORAGE_TOKEN`. Os dois últimos são distintos: o token de agente acessa apenas `/mcp`; o de armazenamento é reservado ao backend de compatibilidade. Nunca publique esses valores.

Opcional: `BUNKER_CLAUDE_AGENT_TOKEN`, credencial dedicada ao Claude Code. É aceita somente em `/mcp`, com o mesmo alcance do token de agente legado (que continua válido); não entra em `/internal/storage`, não cria sessão nem identidade de dono e não aprova propostas. Valor ausente, com menos de 32 caracteres ou igual ao token legado, ao de armazenamento ou à chave de serviço é recusado. O cliente lê o valor de um arquivo privado fora do repositório (`~/.config/bunker-traffic/claude-agent-token`, modo 600) por `scripts/claude-mcp-headers.sh`, configurado como `headersHelper` no `.mcp.json` local; o helper só responde à URL `/mcp` do Worker. Envie ao Cloudflare apenas por stdin.

O backend do Sites usa `BUNKER_STORAGE_GATEWAY` e `BUNKER_STORAGE_TOKEN`. Sem essas variáveis, a compatibilidade antiga continua usando o D1; isso é uma alternativa de recuperação, não replicação automática. Após o corte, restaurar D1 sem conciliar novas gravações perderia atualizações.

## Deploy

`npm ci` → `npm test` → `npm run typecheck` → `npm run build` → `npx wrangler deploy --config dist/server/wrangler.json`.

O build define o nome `bunker-traffic`, não inclui o banco D1 fictício e ativa a autenticação externa. A integração GitHub da Cloudflare executa o build e o deploy da main. Aplique migrations Supabase pelo fluxo autenticado antes de publicar código que dependa delas.

No Supabase Auth, configure o Site URL para a interface acima e autorize somente seu callback `/auth/callback`. A primeira entrada precisa ser validada pelo proprietário no e-mail; envio aceito não comprova entrega ou sessão iniciada.

## Migração e conferência

A cópia de D1 preserva payloads, revisões, horários e arquivos imutáveis. `bunker_import_rows` recusa conflitos e só é executável pelo backend. Confira cada linha após importar e confira que a revisão de origem não mudou antes de direcionar os agentes. Mantenha a origem preservada; não a trate como espelho depois do corte.

As verificações de saúde não provam que uma campanha entregou, que uma aprovação foi executada ou que a coleta está fresca. Permanecem obrigatórios claim/prepare/submit único/confirm, fontes por projeto, cadência e aprovação exata do dono.

## Atualização do fluxo

Uma única rotina da interface confere a revisão da central a cada dez segundos enquanto a aba está visível, e também quando ela volta ao foco. O Supabase retorna apenas revisão e horário nessa checagem; o estado completo é lido quando há uma revisão nova. A checagem é suspensa durante uma gravação e respostas atrasadas não substituem confirmações mais recentes.

Falha de rede, revisão inválida ou regressiva e sessão expirada não são tratadas como atualização concluída. O painel conserva a última base válida e os rascunhos, mostra a limitação e tenta conferir novamente. O horário dessa conferência fica nos detalhes da sincronização, separado dos horários da coleta e da atualização Malva.

Em conflito de edição, a interface tenta reler a central e pede que o operador confira os novos valores. A gravação não é reenviada automaticamente. Uma escolha só sai da fila após sua confirmação exata no histórico; uma execução financeira continua exigindo a autorização e a verificação próprias.

## Leitura Meta ao vivo das campanhas

Decisão do proprietário em 08/11/2026: o secret `Meta_Acess_Token`, cadastrado por ele no Supabase, alimenta a Edge Function `meta-read` (autenticação de serviço, como `orbita-mcp`). Agentes não leem, imprimem nem copiam o valor.

Decisão do proprietário em 09/11/2026 ("dá pra associar a campanha da meta junto com o mcp do malva principalmente pra atualização de dados dos números do tráfego … tanto pro web como pro notch"): a mesma leitura, ainda **somente leitura**, passa a cobrir todas as campanhas Meta ativas dos projetos configurados e a exibir status, orçamento diário, gasto, impressões e cliques de hoje junto da linha do Malva, pelo id da campanha.

- Somente `GET` na Graph API v26.0: `/act_<conta>/campaigns` com campanhas ativas (até 3 páginas por conta, 8 contas em paralelo, até 160 contas e 600 campanhas por leitura), filtrando localmente as campanhas pedidas; uma campanha pedida que sumiu da lista de ativas (pausada há pouco, por exemplo) é lida pelo próprio id (`/<id>`, no máximo 40). Campos: `status`, `effective_status`, `start_time`, `created_time`, `stop_time`, `daily_budget`, `lifetime_budget` e os insights de hoje (gasto, impressões, cliques, cliques no link, IC e compras, pegando o maior entre os tipos de ação equivalentes, sem somar). A leitura em lote por `?ids=` foi descontinuada pela Meta na v26.0.
- A ligação conta Malva → número da conta Meta vem de `tracking_ad_accounts` no ciclo do painel de contas (`metaAccountLinks`). Conta que a Meta recusa para esse token fica de fora por 6 horas. Resposta de limite de chamadas da Meta suspende as leituras por 10 minutos.
- O executor (`syncMetaLive`, pela via rápida) lê a cada 1 minuto e logo depois de uma ordem do dono passar pela via rápida (com pelo menos 10 s entre leituras): primeiro as campanhas novas e programadas, depois todas as outras ativas, maior gasto primeiro. Grava `metaLive` no próprio objeto, fora da central e do Supabase; a cada leitura reconstrói o resumo do notch e move o pulso, que faz o web recarregar.
- Primeiras 24h (`overlayMetaLive`): o início real decide programada/1º dia/2º dia. O IC fica com o maior valor entre as duas fontes; compra vista na Meta tira a campanha do teto.
- Exibição (`lib/meta-display.mjs`), web (`/api/live`) e notch: status, status efetivo e orçamento diário vêm da Meta quando a leitura dela é mais nova que a do Malva; gasto (convertido pela taxa da própria campanha), impressões, cliques e cliques no link vêm da Meta quando estão à frente, no mesmo dia local; custos de anúncio acompanham o gasto na proporção da própria linha (desconhecida → N/D); CTR, CPC, CPM, ROAS, ROI, lucro, margem e CPAs são recalculados com as fórmulas do Malva. IC, pedidos e receita continuam do Malva; IC e compras do pixel ficam à parte (`metaLive`). Leitura com mais de 10 minutos é ignorada. No notch, os números do dia, o placar e o detalhe da campanha usam essa leitura; a fila continua na análise.
- Nunca entra em análise, proposta, aprovação, contingência ou conferência de ordem: a ordem do dono continua comparando o valor ao vivo do Malva, e o executor relê o Malva antes de enviar. Erros viram códigos fixos (`META_190`, `META_HTTP_400`…). Falha mantém a última leitura até ela vencer.
- Ações continuam pela Malva, com proposta aprovada pelo dono ou ordem dele com Touch ID.
- Painel de contas: sem o secret `META_ACCOUNTS_TOKEN` no Worker, o executor lê `/me/adaccounts` pela mesma função (`{"action":"accounts"}`), com o mesmo uso restrito descrito abaixo.

## Token de leitura da Meta para o painel de contas

Decisão do proprietário em 07/11/2026: o painel "Contas de anúncio" mostra o limite de gastos diário que a Meta define para cada conta (`adtrust_dsl`), que o Malva não fornece. O executor lê `/me/adaccounts` com um token próprio, **somente leitura** (`ads_read`), no secret `META_ACCOUNTS_TOKEN` do Worker. O token é criado e cadastrado pelo proprietário; agentes não leem, imprimem nem copiam o valor.

- Uso exclusivo: limite diário, status e gasto de hoje das contas que pertencem a projetos configurados. Contas que só a Meta enxerga são ignoradas.
- O token vai só no cabeçalho `Authorization`; a paginação usa o cursor `after`; erros viram códigos fixos (`META_190`, `META_HTTP_400`…), sem URL ou token.
- Leitura a cada 30 minutos; o painel fica no Durable Object do executor, fora da central e do Supabase.
- Ações em campanhas continuam exclusivamente pelo Malva, com proposta exata aprovada e claim → prepare → submit único → confirmação. Este token não é usado para escrita.
- Sem o token, o painel funciona com o restante dos dados e mostra o limite como N/D.

## Chave do Mac para decisões do dono (Touch ID)

Decisão do proprietário em 07/11/2026: decidir pelo notch sem o login por link de e-mail, confirmando cada decisão com Touch ID, e com a revisão da equipe mantida.

Nova decisão do proprietário em 07/11/2026 (substitui "Sim, passa pela equipe"; confirmada por ele nas duas sessões: "Ordem direta do dono" e "Confirmo ordem direta"): no notch, "Executar agora" é uma **ordem direta do dono**. Ela vira proposta exata selada do round atual, criada e aprovada só pelo dono (sem parecer dos agentes), e segue o caminho normal do executor. Só pelo Mac, com Touch ID por ordem. Na web continua o caminho com proposta revisada.

- O app do Mac cria uma chave P-256 no Secure Enclave (acesso `userPresence`: Touch ID ou senha do Mac em cada assinatura). Nas Chaves fica só o bloco cifrado, utilizável apenas por este chip. A parte pública é gravada em `~/.config/bunker-traffic/owner-device-public-key`.
- O Worker guarda só a chave pública em `BUNKER_OWNER_DEVICE_KEY` (base64 X9.63, 65 bytes). Ela não assina nada; sem ela a rota responde 503.
- `POST /api/companion/owner` aceita apenas o envelope assinado `{v:1,key,payload,sig}`; o payload exato é `{aud:'bunker-traffic/owner-device',iat,input}`, com validade de 2 minutos. A fronteira de autenticação repassa só o input verificado, com `x-bunker-owner-device: mac-touchid:<keyId>`; cabeçalhos forjados são apagados em todas as rotas.
- Operações aceitas: `cardDecision` (intenção para a equipe, ou aprovação exata do card) e `proposalReview` (aprovar, recusar ou pedir revisão de proposta já revisada pelos agentes). Mesma revisão otimista, `assertCurrentDecisionContext`, contingência e `ownerAutonomy` da web. Nada além disso.
- `GET /api/companion/cards` (sessão do dono ou credencial de leitura do app) devolve os cards e propostas com os selos que o pedido assinado precisa repetir.
- A execução continua exclusiva do executor Cloudflare: claim → prepare → submit único → Malva MCP → conferência, com `authorizeCloudDispatch` conferindo o comando. A chave do Mac não aciona provedor diretamente.
- Ordem direta (`cardDecision` com `ownerOrder:true` dentro do pedido assinado; `ownerDeviceOps` não muda): só pausa, ou orçamento diário de/para, de campanha Meta com leitura completa e recente de hoje, moeda nativa e orçamento CBO próprio. O Mac repete no pedido assinado os valores que mostrou (`expected` com status, orçamento e moeda; `after` com o orçamento novo): qualquer diferença com o valor atual é recusada com `DIRECT_ORDER_CHANGED` (409, com os valores atuais), nunca recalculada; um Mac antigo sem `expected` só tem ordem de orçamento aceita enquanto a base do servidor é igual à do card. Antes de gravar, o valor atual é comparado com a leitura ao vivo (divergência bloqueia) e passa pela contingência, que inclui o teto diário do projeto quando configurado. É incompatível com `applied` e `approveExact`; recusada se já houver proposta em andamento para a campanha; válida por 60 minutos. Ativação não é oferecida. Parecer da equipe, meta de retorno e teto não configurado aparecem como informação, sem travar.
- Trocar de Mac ou perder a chave: o app cria outra; registre a nova parte pública no secret (stdin) e a anterior deixa de valer.

## Ordem direta do notch sem rodada (`ownerDirectOrder`, 08/11/2026)

Pedido do proprietário em 08/11/2026: "Eu quero poder pausar, aumentar, reduzir direto do notch [...] E preciso que tudo seja feito via mcp malva". Diagnóstico: nenhuma ordem direta tinha chegado ao servidor; o caminho por card exigia a revisão da central do momento em que o notch abriu (o executor grava a central a cada poucos segundos, então quase sempre dava 409), uma rodada de análise válida, o card da campanha e nenhuma decisão anterior; a autorização ainda morria se uma coleta nova começasse antes do envio.

- Operação nova do Mac, `ownerDirectOrder` (agora em `ownerDeviceOps`): `{project, adAccountId, objectId, action: pause|increase|reduce, percent?, expected:{status,dailyBudget,currency}, after?:{dailyBudget}, clientId}`, assinada com Touch ID. Não depende da revisão da central, da rodada, do card nem de escolhas anteriores.
- O servidor (`lib/owner-direct-order.mjs`, rota `app/api/companion/owner`) lê a linha ao vivo da Malva (`live:<projeto>`, até 10 min, completa, `Malva MCP`) e exige que `expected` seja igual ao valor atual; se mudou, recusa com o valor de agora (409), nunca recalcula sozinho. Só Meta, ID interno UUID, moeda nativa, sem aquecimento; pausa só de ativa; orçamento só diário próprio (CBO); aumento bloqueado com conta inapta; aumento até 1000%, redução abaixo de 100%. Teto do dono (decisão de 09/11/2026, `lib/owner-budget-cap.mjs`): aumento digitado à mão, na ordem direta e na ordem do card, cujo novo orçamento diário passa do teto da campanha (`budgetCaps[conta]`, senão `budgetCap`, da política privada da Sombra com a camada do dono, na moeda nativa) é recusado antes de gravar (`DIRECT_ORDER_CAP`, com o maior percentual possível); redução e pausa nunca são limitadas; sem teto configurado não há limite. O notch mostra "Seu teto" e desliga só "Executar agora". Contingência (`decisionContingency`) igual. Uma ordem aprovada e não aplicada da mesma campanha bloqueia outra.
- Vira uma proposta exata `Aprovada` com `roundId:null`, `directOrder:true`, `liveTarget` e validade de 15 min. `approvedExecutionProposal` dispensa só a rodada e as fontes da análise para ela (`isDirectOwnerOrder`); pausa do escritório, validade, aquecimento e selo continuam. O executor Cloudflare faz claim → prepare (relê a Malva por `tracking_ad_detail` com o ID interno da ordem e compara) → submit único (`dispatchGranted`) → `tracking_set_ad_status`/`tracking_set_ad_budget` pela Malva → releitura → confirmação. `authorizeCloudDispatch` confere o comando.
- `GET /api/companion/cards` com projeto, conta e campanha devolve `directOrder` (ações possíveis, bloqueios e o valor ao vivo), mesmo sem card. O recibo segue em "Suas ordens". Ordens diretas terminadas saem da central após 7 dias; envio sem confirmação nunca sai.
- Sem ativação, lance, público, criativo ou campanha nova. A web continua no caminho da proposta revisada.

## Ordem direta com leitura ao vivo (07/11/2026)

Quando a análise dos quatro períodos tem mais de 1 hora (por exemplo, à noite, fora da agenda de coletas), a ordem direta do dono pode usar a **leitura ao vivo** da campanha, de até 10 minutos, lida pelo servidor no cache `live:<projeto>`. O valor de antes vem dessa leitura (`payload.liveTarget`). Só para essas ordens, o executor dispensa a idade de 1 hora da análise. Continuam valendo:
- o round válido;
- a pré-conferência na Malva antes do envio (o valor atual precisa bater com `liveTarget`, ou a ordem é recusada);
- a contingência, com o teto diário do projeto quando configurado;
- o envio único e a releitura.

As propostas da equipe seguem a regra de 1 hora. O notch mostra a origem do valor: "valor ao vivo de HH:MM" ou "valor da análise".

## Webhook de vendas da Malva (07/11/2026)

`POST /api/webhooks/malva/<segredo>/<id do projeto Malva>`. Um webhook por projeto. O segredo é conferido em tempo constante na borda antes de ler o corpo (limite de 64 KB, cabeçalhos de identidade apagados). O projeto do endereço é a única autoridade sobre onde a venda aparece: endereço sem projeto é recusado (400); projeto que não é um dos projetos Meta configurados no Bunker, pedido que cita outro projeto ou mais de um (no envelope, em `data` ou no pedido), e pedido sem id são recusados (422) e nunca aparecem em todos os projetos.

Só entra venda com prova explícita de pagamento: status ou assunto paid/approved/aprovado/pago/completed/confirmado. Qualquer status negativo vence, venha do envelope ou de `data` (pending, unpaid, aguardando, recusado, rejected, reprovado, expirado, cancelado, reembolso, estorno, chargeback, processing, erro, parcial), assim como uma negação antes de uma palavra positiva (not_approved, não pago, unconfirmed, incomplete). Um assunto genérico como `order.created` ou um valor solto não contam como pagamento. Esses eventos recebem 200 com `ignored`, para a Malva não reenviar. A venda vira só informação: valor, moeda, produto, campanha (utm), projeto e horário. Dados do comprador nunca entram. O id do pedido vira um hash curto de projeto + pedido, para um reenvio não duplicar e pedidos iguais em projetos diferentes não colidirem. Uma venda nunca propõe, aprova nem executa nada. O notch mostra a venda no rodízio e o Bunk comemora; o aviso a cada venda é opcional, no menu. O formato oficial do evento da Malva ainda não foi conferido: a primeira entrega real (em Entregas do webhook) mostra se foi aceita ou o motivo da recusa.

Configuração, feita pelo dono (o segredo não aparece na tela):
1. No terminal, na pasta do projeto:
   `s=$(openssl rand -hex 32); printf %s "$s" | npx wrangler secret put MALVA_WEBHOOK_SECRET --name bunker-traffic; printf %s "https://bunker-traffic.erik-iplou.workers.dev/api/webhooks/malva/$s/" | pbcopy; unset s`
   Cadastrar o segredo cria uma versão nova do Worker: siga o protocolo de publicador único.
2. Na Malva, em Integrações › Webhooks de cada projeto Meta: crie um webhook no formato Malva para os assuntos de venda paga, colando o endereço da área de transferência e acrescentando no fim o id desse projeto na Malva. Projeto Kwai fica de fora.

## Avisos no iPhone pelo Pushover (08/11/2026)

Pedido do dono: o Bunk avisar no iPhone, também com o Mac desligado. O executor Cloudflare, logo depois de regravar o resumo do notch (`companion:all`), manda pelo Pushover os mesmos quatro tipos que o notch avisa: perda para revisar, proposta aguardando o dono, ordem direta confirmada/não enviada/a conferir e ritmo do orçamento (uma vez por dia do Bunker, fuso de Boa Vista, por projeto e tipo). Código: `lib/phone-alerts.mjs`, testes em `tests/phone-alerts.test.mjs`. Não cria agendamento novo: roda dentro do pulso que já existe.

- Só aviso: nunca aprova, executa nem leva comando. Tocar abre a interface privada do Bunker, onde as regras de aprovação continuam as mesmas.
- Primeira leitura só registra o que já existe (nada antigo toca). Perda toca uma vez por campanha e de novo só quando cresce 1,5× na mesma janela e base ("Perda cresceu"); a mensagem diz a janela (hoje ou 3 dias completos). Troca de janela ou de base (prejuízo / receita abaixo da mídia) só toca de novo se o valor for 1,5× o último avisado. O último erro de envio fica no status até um envio dar certo. Ordens do dono saem primeiro, depois propostas, perdas e ritmo. No máximo 5 mensagens por leitura; o resto vai na seguinte. Falha 429/5xx/rede fica pendente para a próxima leitura; recusa 4xx (token ou usuário errado) não é repetida.
- Vendas e ajustes de gestores não vão para o iPhone (escolha do dono). O "Silenciar avisos" do Mac não vale aqui: use o silêncio/horário de descanso do próprio app Pushover.
- O texto (projeto, campanha, valores) passa pelos servidores do Pushover. Nenhum dado do comprador entra.
- Desligado sem os dois segredos `PUSHOVER_TOKEN` (token da aplicação) e `PUSHOVER_USER` (user key). Conferência: `GET /api/executor` (ou o status MCP) devolve `phone` com `configured`, `primed`, `sent`, `lastSentAt` e `lastError`, sem os valores.

Configuração, feita pelo dono (o valor só é digitado no prompt oculto do wrangler, nunca no chat):
1. Instalar o app Pushover no iPhone e entrar; a "User Key" aparece na tela inicial de pushover.net.
2. Em pushover.net › "Create an Application/API Token", criar a aplicação "Bunker" e copiar o "API Token".
3. Na pasta do projeto: `npx wrangler secret put PUSHOVER_TOKEN --name bunker-traffic` e depois `npx wrangler secret put PUSHOVER_USER --name bunker-traffic`. Cada segredo cria uma versão nova do Worker: siga o protocolo de publicador único.
