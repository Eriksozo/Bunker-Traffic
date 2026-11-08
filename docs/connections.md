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

## Leitura Meta ao vivo das campanhas novas

Decisão do proprietário em 08/11/2026: o secret `Meta_Acess_Token`, cadastrado por ele no Supabase, alimenta a Edge Function `meta-read` (autenticação de serviço, como `orbita-mcp`). Agentes não leem, imprimem nem copiam o valor.

- Somente `GET` na Graph API (`?ids=…`, até 50 por pedido e 200 por leitura): `status`, `effective_status`, `start_time`, `created_time`, `stop_time` e os insights de hoje (gasto, impressões, IC e compras, pegando o maior entre os tipos de ação equivalentes, sem somar).
- O executor (`syncMetaLive`) lê a cada 2 minutos só as campanhas datadas de 2 dias atrás até 14 à frente, depois testes e campanhas sem data no nome. Grava `metaLive` no próprio objeto, fora da central e do Supabase.
- Uso: só a lógica das primeiras 24h (`overlayMetaLive`). O início real decide programada/1º dia/2º dia. O gasto da Meta só substitui o da Malva quando está à frente, no mesmo dia local do projeto, convertido pela taxa da própria campanha. O IC fica com o maior valor entre as duas fontes; compra vista na Meta tira a campanha do teto. Leitura com mais de 10 minutos é ignorada.
- Pedidos, receita, ROI e as demais regras continuam com a Malva. Erros viram códigos fixos (`META_190`, `META_HTTP_400`…). Falha mantém a última leitura até ela vencer.
- Ações continuam pela Malva, com proposta aprovada pelo dono.

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
- Ordem direta (`cardDecision` com `ownerOrder:true` dentro do pedido assinado; `ownerDeviceOps` não muda): só pausa, ou orçamento diário de/para, de campanha Meta com leitura completa e recente de hoje, moeda nativa e orçamento CBO próprio. Antes de gravar, o valor atual é comparado com a leitura ao vivo (divergência bloqueia) e passa pela contingência, que inclui o teto diário do projeto quando configurado. É incompatível com `applied` e `approveExact`; recusada se já houver proposta em andamento para a campanha; válida por 60 minutos. Ativação não é oferecida. Parecer da equipe, meta de retorno e teto não configurado aparecem como informação, sem travar.
- Trocar de Mac ou perder a chave: o app cria outra; registre a nova parte pública no secret (stdin) e a anterior deixa de valer.

## Ordem direta com leitura ao vivo (07/11/2026)

Quando a análise dos quatro períodos tem mais de 1 hora (por exemplo, à noite, fora da agenda de coletas), a ordem direta do dono pode usar a **leitura ao vivo** da campanha, de até 10 minutos, lida pelo servidor no cache `live:<projeto>`. O valor de antes vem dessa leitura (`payload.liveTarget`). Só para essas ordens, o executor dispensa a idade de 1 hora da análise. Continuam valendo:
- o round válido;
- a pré-conferência na Malva antes do envio (o valor atual precisa bater com `liveTarget`, ou a ordem é recusada);
- a contingência, com o teto diário do projeto quando configurado;
- o envio único e a releitura.

As propostas da equipe seguem a regra de 1 hora. O notch mostra a origem do valor: "valor ao vivo de HH:MM" ou "valor da análise".

## Webhook de vendas da Malva (07/11/2026)

`POST /api/webhooks/malva/<segredo>`. O segredo é o último trecho do caminho, conferido em tempo constante na borda antes de ler o corpo (limite de 64 KB, cabeçalhos de identidade apagados). A venda vira só informação: valor, moeda, produto, campanha (utm), projeto e horário. Dados do comprador nunca entram, e o id do pedido vira um hash curto para não duplicar. Uma venda nunca propõe, aprova nem executa nada. O notch mostra a venda no rodízio e o Bunk comemora; o aviso a cada venda é opcional, no menu.

Configuração, feita pelo dono (o segredo não aparece na tela):
1. No terminal, na pasta do projeto:
   `s=$(openssl rand -hex 32); printf %s "$s" | npx wrangler secret put MALVA_WEBHOOK_SECRET --name bunker-traffic; printf %s "https://bunker-traffic.erik-iplou.workers.dev/api/webhooks/malva/$s" | pbcopy; unset s`
   Cadastrar o segredo cria uma versão nova do Worker: siga o protocolo de publicador único.
2. Na Malva, em Integrações › Webhooks: crie um webhook no formato Malva para os assuntos de venda paga, colando o endereço que ficou na área de transferência. Faça isso em cada projeto.
