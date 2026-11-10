# Repasse de operação — Claude principal, Codex copiloto

Data: 06/11/2026, horário do proprietário America/Boa_Vista. Este arquivo é orientação de continuidade; não é uma leitura financeira atual nem autorização de campanha.

## Projeto certo

- Checkout: `/Users/erikmagalhaessilva/Desktop/Sistemas/Bunker-Traffic`.
- Repositório: `git@github.com:Eriksozo/Bunker-Traffic.git`, branch `main`.
- Interface principal: https://bunker-traffic.erik-iplou.workers.dev/.
- Interface privada/compatibilidade MCP: https://bunker-trafego-erik.eriksozo.chatgpt.site/.
- Baseline de código antes deste repasse: `92bb0b484cbb74d7be5cf2ea3a5ed9f6f741028e`, 928 testes + tipos + build aprovados naquela revisão. Revalidar se o código mudou.
- Cloudflare baseline: `c28a3bc9-c2f8-4113-924c-6d0462021144`. É referência histórica; conferir a versão atual antes de qualquer deploy.

## Arquitetura e responsabilidades

React/Vinext apresenta a dashboard. O Durable Object `BunkerCloudExecutor` na Cloudflare coordena coletas, pareceres, aprendizado e execuções exatas aprovadas. Supabase guarda estado, relatórios, arquivos e autenticação. Malva é a fonte e o caminho de ações de anúncios. Órbita fornece contexto de produção e nomenclaturas de criativos; cadastro/aprovação nela não comprova entrega na Meta.

MCP do Bunker para o Claude: `https://bunker-traffic.erik-iplou.workers.dev/mcp`, com credencial própria `BUNKER_CLAUDE_AGENT_TOKEN` entregue pelo `headersHelper` (ver seção "Status verificado em 07/11/2026"). O MCP privado do Sites (`https://bunker-trafego-erik.eriksozo.chatgpt.site/mcp`) continua compatível com o Codex, mas exige OAuth OpenAI sem registro dinâmico de cliente e não funciona para o Claude; não tentar autenticar o Claude por ele. Ler `bunker_ler` no início para obter revisão, runbook e fila reais. Processar primeiro conferências e execuções aprovadas, depois a fila autônoma e coletas elegíveis. Não iniciar reserva ou coleta fora da agenda. Não criar uma segunda rotina para competir com a Cloudflare.

## O que acabou de mudar

- `8235b97`: fontes compactadas volumosas passam para registros imutáveis por SHA-256, no mesmo commit transacional/CAS da central. Falta/corrupção falha explicitamente, sem fabricar fontes vazias. Formatos antigos continuam legíveis. O teto por registro não foi removido.
- A visão geral distingue base antiga de classificação vazia: `—` indica classificação indisponível. Acompanhamento visual recente não renova os quatro períodos da análise. Há atalho para revisões e contagem explícita de campanhas aguardando revisão.
- `92bb0b4`: invalidação de fonte permanece definitiva. Uma coleta sucessora que falha não ressuscita uma triagem dispensada nem uma autorização anterior.
- Na verificação dessa entrega, as 72 fontes foram preservadas e a central passou de aproximadamente 1,75 MB a 0,91 MB. Não reutilizar esses números como medição atual. A conferência visual de layout não foi concluída naquela entrega.

## Conexões: configurar não significa autenticar

A conta Claude selecionada pelo proprietário foi autorizada para este repasse. A configuração de servidores do projeto fica em `.mcp.json`, sem chaves. Os conectores do Codex não são automaticamente compartilhados com outro cliente.

| Serviço | Caminho de acesso | Como confirmar |
| --- | --- | --- |
| Bunker | Claude: Worker `/mcp` + `headersHelper` com token próprio. Codex: MCP privado do Sites com OAuth do próprio cliente | `bunker_ler` deve retornar revisão, fonte e plano atuais; não basta aparecer na lista. |
| Malva | `https://malvadash.com/api/mcp` | Identidade/workspace e lista de projetos; conferir seis projetos Meta e seu alcance antes de escrever. |
| Órbita | `https://dashops.forallsales.com.br/api/mcp`; configuração de usuário Claude já existente | `quem_sou_eu`; identidade e projeto/expert precisam corresponder. Não duplicar/expor seu cabeçalho existente. |
| Supabase | MCP oficial limitado ao projeto Bunker Traffic | OAuth, identidade do projeto e uma consulta de metadados somente leitura. Não despejar `payload` ou secrets. |
| Cloudflare | MCP oficial `https://mcp.cloudflare.com/mcp` ou Wrangler já autenticado neste Mac | Conferir conta, Worker `bunker-traffic` e versão, sem exportar credenciais. |
| GitHub | Conector Claude já listado como conectado; Git SSH do checkout | `git ls-remote origin HEAD` e ferramenta de leitura; não confundir com autorização de branch/conta diferente. |

Se um servidor pedir OAuth, concluir o fluxo próprio no cliente. Se pedir senha/nova credencial, pedir entrada ao proprietário. Não usar cookies, perfis, tokens do Codex ou valores de secrets como atalho de autenticação. O backend Cloudflare já usa secrets próprios para Malva e Órbita; não é necessário copiá-los para operar pelo Bunker.

Referências de instalação: [Claude MCP](https://code.claude.com/docs/en/mcp), [Supabase MCP](https://supabase.com/docs/guides/ai-tools/mcp), [Cloudflare MCP](https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/).

## Primeira tarefa do Claude

1. Ler este documento, `CLAUDE.md` e o runbook. Conferir repositório, branch e arquivos locais; não sobrescrever alterações em andamento.
2. Inventariar ferramentas **realmente disponíveis nesta sessão**. Para cada serviço, registrar `confirmado`, `configurado/aguardando autenticação` ou `indisponível`, com horário da leitura. Não declarar conexão por haver uma URL no JSON.
3. Fazer apenas leituras: saúde HTTP, identidade Malva/Órbita, revisão Bunker, executor/status e metadados Supabase. Não reservar rodada, alterar cadência ou executar anúncio durante esse diagnóstico.
4. Apresentar ao dono um resumo curto do que está acessível e qual autorização/interação ainda falta. Se necessário, concluir os logins e repetir só a verificação pertinente.
5. Aguardar a próxima prioridade concreta do proprietário. Para implementação, Claude conduz; Codex revisa os pontos necessários. Nada de ciclos ilimitados de autoaprimoramento.

## Comandos locais

```sh
git status --short
git rev-parse HEAD origin/main
git ls-remote origin HEAD
npm test
npm run typecheck
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js deploy --config dist/server/wrangler.json
```

Rodar deploy apenas após uma mudança autorizada e validada. Não executar este último comando como teste de conexão. Para documentação ou configuração sem código, a validação correspondente é suficiente; não gerar deploy ou campanha só para provar acesso.

## Próximos pontos que merecem evidência

- Conferir se as coletas completas dos seis projetos voltaram a persistir após a correção de capacidade. Gravação v3 e saúde HTTP não comprovam atualização de todas as análises.
- Acompanhar crescimento dos registros imutáveis antes de definir retenção; não apagar histórico ou fontes pendentes para liberar espaço.
- Concluir QA visual do estado de análise e dos cards quando houver controle de navegador disponível.
- Preservar fila, aprovações, recibos de envio único, resultados favoráveis/desfavoráveis e incerteza causal dos aprendizados.

## Status verificado em 07/11/2026 (≈02:05 UTC)

Mudança desta etapa: commit `31afd92` (credencial dedicada do Claude restrita a `/mcp`), implantado automaticamente pela integração GitHub como versão Cloudflare `d18a97e2-4b63-49b1-ae1c-05c46ad6538a` (100%). O secret `BUNKER_CLAUDE_AGENT_TOKEN` foi enviado por stdin; a versão implantada mantém os sete secrets anteriores. O token de agente legado continua aceito. A credencial do Claude é recusada em `/internal/storage` e `/api/*` (401 conferido em produção) e não cria identidade de dono nem aprova propostas. Cliente: `.mcp.json` local (fora do Git) aponta `bunker` para o Worker com `headersHelper` → `scripts/claude-mcp-headers.sh`, que lê um arquivo privado fora do repositório (modo 600) e só responde à URL `/mcp` do Worker. Testes: 931 aprovados, typecheck e build aprovados.

| Acesso | Status real | Evidência / limitação |
| --- | --- | --- |
| Bunker | Confirmado pela credencial própria (JSON-RPC direto ao `/mcp`) | `initialize`, `tools/list` (9 ferramentas) e `bunker_ler` com 200; status do executor pelo envelope `cloud-data` com 200. O conector `bunker` da sessão do Claude Desktop iniciada antes da mudança ainda mostrava a configuração antiga; recarregar em `/mcp` ou abrir sessão nova. |
| Órbita | Confirmado (ferramenta MCP da sessão) | `quem_sou_eu`: usuário SOZO, papéis Tráfego/Líder de tráfego. O e-mail da Órbita difere do e-mail da conta Claude; a conciliação com o proprietário Malva é feita pelo backend. |
| GitHub | Confirmado | `git ls-remote` e push SSH do commit `31afd92`. |
| Cloudflare | Wrangler local confirmado; MCP oficial pendente nesta sessão | Wrangler: conta Erik Sozo, versões e secrets (somente nomes). O OAuth foi concluído pelo proprietário, mas a sessão aberta continuou `needs_auth`. |
| Malva | Pendente nesta sessão | OAuth concluído pelo proprietário (espaço Epidemia), mas a sessão aberta continuou `needs_auth`; `workspace_whoami` não foi chamado pelo Claude. A última conferência do executor (04/11) registrou o workspace e sete projetos Malva, incluindo Gabe Kwai, que fica fora do escopo. |
| Supabase | Pendente nesta sessão | OAuth concluído pelo proprietário (projeto Bunker Traffic), mas a sessão aberta continuou `needs_auth`; `get_project_url`/`list_tables` não foram chamados. |

Limitações observadas, sem correção nesta etapa:
- O executor está ativo e não pausado, fora da janela automática no momento da leitura (agenda 06:00–20:00, a cada 15 min, America/Sao_Paulo). Nenhuma análise devida.
- O histórico recente do executor (30 eventos, ≈01:33–02:01 UTC) tem quatro `CLOUD_STEP_FAILED`, com o último detalhe "Falha no armazenamento Supabase (500)". Investigar antes da próxima janela; não foi reprocessado nem repetido.
- O armazenamento da central estava em ≈1,30 MB de 1,75 MB (72 fontes). É uma leitura pontual, não uma tendência.
- Pendência para o Claude: recarregar Malva, Supabase e Cloudflare numa sessão que enxergue o OAuth concluído e repetir somente as leituras de identidade.

### Confirmação após abrir uma sessão nova — 07/11/2026, 02:05 UTC

Esta conferência substitui as pendências de autenticação da tabela anterior. Na sessão **Operação Bunker validação de conexões**, os cinco MCPs responderam pelas ferramentas do próprio Claude: Malva (`workspace_whoami` e projetos), Órbita (`quem_sou_eu`), Supabase (URL do projeto e nomes das tabelas), Cloudflare (usuário/contas) e Bunker (`bunker_ler`). Nenhum permaneceu em `needs_auth`. GitHub já estava confirmado pelo Git SSH e pelos pushes. Claude conduz a implementação; Codex revisa e valida como copiloto.

- Malva: espaço Epidemia, Tracking com acesso de gerente e escopo `tracking:ads`; seis projetos Meta identificados. Gabe Kwai e a conta MGID do John permanecem fora do escopo.
- Órbita: identidade SOZO e papéis de Tráfego/Líder confirmados, conciliados com a identidade Malva.
- Supabase: projeto Bunker Traffic; `bunker_records` e `bunker_reports` encontrados com RLS ativo. Nenhum payload ou secret foi exportado.
- Cloudflare: conta Erik Sozo confirmada pelo MCP, além do Wrangler já validado.
- Bunker: revisão 5437 lida pelo MCP da sessão nova, sem pausa, nenhuma análise devida e nenhuma execução aprovada pendente naquele instante. A fonte do John foi indicada como vencida; conexão disponível não renova a análise.
- O classificador de permissões do Claude bloqueou a leitura adicional de status pelo envelope `cloud-data`, pois a ferramenta se chama `bunker_atualizar_rodada`. Esse bloqueio não foi contornado. A leitura direta feita na sessão anterior continua sendo evidência pontual, não uma nova confirmação.
- As falhas Supabase 500 registradas acima continuam pendentes de investigação. Não foram reprocessadas, e nenhuma campanha, aprovação, cadência ou pausa foi alterada nesta validação.

Os OAuths pertencem ao cliente Claude e devem ser renovados pelo fluxo próprio quando necessário. A credencial dedicada do Bunker permanece em arquivo privado fora do Git. O próximo trabalho concreto deve começar pela investigação de persistência do executor, preservando histórico e reservas; este repasse não autoriza aprovar propostas pelo proprietário.

## Validação de conexões pela sessão nova do Claude — 07/11/2026 (status do executor lido com `controlReadAt` 02:13:49 UTC)

Somente leituras pelos MCPs da própria sessão; nenhuma reserva, coleta, campanha, agenda, pausa, dado, código ou infraestrutura alterados.

| Acesso | Status real | Evidência |
| --- | --- | --- |
| Malva | Confirmado | `workspace_whoami`: Erik Sozo, espaço Epidemia, conexão OAuth "Claude Code (malva)"; papel Leitor com Tracking gerente e escopo `tracking:ads`; Financeiro sem acesso. O token OAuth da sessão expira em 07/11 03:00 UTC. `tracking_list_projects`: Gabe, John, Leandro, Murilo, Nico, Ronald (Meta, BRL, America/Sao_Paulo, ao vivo) e Gabe Kwai (fora do escopo). |
| Órbita | Confirmado | `quem_sou_eu`: sigla SOZO, papéis Tráfego/Líder de tráfego, squads SQ1–SQ3. |
| Supabase | Confirmado | `get_project_url` do projeto Bunker Traffic; `list_tables`: `bunker_records` e `bunker_reports`, ambas com RLS. |
| Cloudflare MCP | Confirmado para leitura de conta | `whoami` e `GET /accounts`: uma conta, "Erik Sozo". A consulta de telemetria de Workers exige o escopo adicional `workers-observability.write`; o MCP voltou a `needs_auth` pedindo esse escopo. Reautorizar pelo `/mcp` do cliente somente se a leitura de logs do Worker for necessária. |
| Bunker | Confirmado | `bunker_ler` pelo Worker `/mcp` com credencial própria: revisão 5437, sem pausa, nada devido, sem execuções aprovadas; refresh pendente da fonte John. Status do executor (`cloud-data`): ativo, `host: cloudflare`, `independentOfDesktop: true`, último pulso `idle`. |

Diagnóstico das falhas `CLOUD_STEP_FAILED` (sem correção nesta etapa):
- Causa confirmada nos logs do Supabase: cada falha foi um `POST /rest/v1/rpc/bunker_store` cancelado pelo PostgREST com `57014 canceling statement due to statement timeout` após ≈8,6–10,8 s. O papel `authenticator` tem `statement_timeout=8s` e `lock_timeout=8s`.
- 17 timeouts nas últimas 24 h, todos a partir de 06/11 22:00 UTC (1 às 22h, 4 às 23h, 3 às 00h, 8 à 01h, 1 às 02h). Nenhum entre 02:02 e 02:15 UTC.
- Tendência: p95 das chamadas bem-sucedidas de `bunker_store` subiu de ≈0,3 s (06/11 02h UTC) para ≈1,2–2,1 s (20h–23h UTC); máximas de 7,5–12,6 s em horas sem falha registrada.
- `bunker_records`: 565 linhas vivas, heap 232 kB, mas 66 MB no total (TOAST) após ≈17,5 mil atualizações da central (≈1,30 MB por gravação). Indício de inchaço do TOAST; não comprovado como causa.
- Não identificado: qual operação de `bunker_store` (commit da central, `reports`, `daily`, `suggestions`/`collaborations` ou `resolutions`) excedeu o limite. `pg_stat_statements` registra só a chamada RPC de nível superior, e o `lastErrorDetail` do executor é limpo pelo próximo passo bem-sucedido.
- Próximo passo sugerido (exige decisão do proprietário): identificar a operação lenta (log por operação no Worker ou telemetria com escopo adicional) antes de qualquer mudança de esquema, timeout ou retenção. Não aumentar timeouts nem apagar histórico para contornar.

## Gargalo de persistência do executor — causa e correção (07/11/2026: investigação após 02:13:49 UTC; migração registrada às 02:31:58 UTC; registro escrito às 02:34:10 UTC por `date -u`)

Estado: revisado e aprovado pelo Codex (instrumentação e migração de duas linhas); aplicação e publicação autorizadas pelo proprietário via copiloto. Reversão: reaplicar a função de `20261104175212_index_card_archive_projects.sql`, que difere só nas duas linhas do ramo `get`.

Causa confirmada (leituras Supabase somente leitura):
- As 17 respostas 500 de `bunker_store` em 24 h tinham corpo de 48 bytes (`get` da `central` completa) ou 115 bytes (`get` do blob `snapshots:<sha256>` v3). Os três `CLOUD_STEP_FAILED` do executor terminam ≈9 s depois de três desses `get central`. Todas canceladas por `57014 statement timeout` (8 s do papel `authenticator`).
- O ramo `get` usava `key in (select jsonb_array_elements_text(...))` com `to_jsonb(r)`: plano Hash Semi Join sobre Seq Scan das 565 linhas, montando a linha inteira de cada uma e buscando todo o TOAST antes do filtro. Medido também sob `plan_cache_mode=force_generic_plan`: 8.820 buffers (≈69 MB) e ≈80 ms em cache quente para devolver uma linha.
- Hipótese de inchaço do TOAST não é a causa principal: 50 MB de payload vivo para 61 MB de relação TOAST. O TOAST estava todo em cache (`toast_blks_read=0`); o custo é a leitura dos 50 MB vivos a cada `get`, multiplicada pela frequência (≈5,9 mil `get central` e ≈2,7 mil `get snapshots` em 24 h). Por que o tempo chega a 8–12 s em parte das chamadas (contenção ou limite de CPU da instância) não foi medido.

Correção:
- Migração `supabase/migrations/20261107023158_index_bound_record_get.sql` (criada por `supabase migration new` como `…022811`; renomeada para a versão que o Supabase registrou ao aplicar): só o ramo `get` muda para `key = any(array(select jsonb_array_elements_text(input->'keys')))`, nas duas projeções. O corpo vivo conferido antes era idêntico ao da migração anterior (md5 do corpo `bd22b7dc…`). Plano genérico novo: Bitmap Index Scan em `bunker_records_pkey`, 198 buffers, ≈7 ms. Equivalência conferida na base viva, só por hash, em 7 casos: uma chave, chave repetida, ausente, lista vazia, `keys` nulo, várias chaves com repetição e projeção `revision` sem `payload`. Os três chamadores de várias chaves indexam por chave; a ordem não importa.
- Instrumentação em `lib/supabase-storage.mjs`: cada falha e cada operação com 2 s ou mais gera `console.warn` com operação e classes de chave de vocabulário fechado, quantidade de chaves, duração (incluindo a leitura e decodificação do corpo), status, SQLSTATE e `requestId` (somente UUID ou CF-Ray). Falhas de rede, timeout e corpo indecodificável usam mensagens fixas. Nenhum payload, chave, SQL, URL ou token; sem retry.
- `lib/cloud-failure-diagnostics.mjs` grava o mesmo diagnóstico saneado em `lastFailure`/`history` e nas falhas de coleta, preservado após um passo bem-sucedido.
- Testes: suíte completa, typecheck e build aprovados (novos testes comportamentais: transporte, decodificação, saneamento e preservação do diagnóstico). A migração não tem teste automatizado: a evidência é a execução na base (7 casos semânticos e o plano genérico acima).

Limitações:
- Não há Postgres local; a equivalência SQL foi comprovada na base viva por leitura, não por teste automatizado.
- `collaborations` decodifica todas as colaborações do projeto antes do limite; não faz parte das falhas e ficou fora desta etapa.

Aplicação no Supabase Bunker Traffic, versão `20261107023158` (02:31:58 UTC, conforme registrado pelo Supabase):
- O corpo vivo é idêntico ao do arquivo (md5 `cc29c4ed…`). A ACL (`postgres`, `service_role`), o `search_path` e o modo security invoker não mudaram. Índices, RLS, timeouts e dados não foram tocados.
- Pela própria função, os 7 casos deram hashes idênticos à forma anterior e aos valores medidos antes da aplicação. A projeção `revision` não traz `payload`, e a central continuou na revisão 5437.
- Em 8 chamadas seguidas, `get central` levou de 4 a 18 ms (de 4 a 6 ms a partir da 6ª, já com plano em cache). `auto_explain` não é permitido neste projeto, então o plano interno foi conferido pelo `PREPARE` genérico com a mesma instrução.

Publicação e conferência pós-deploy (registro escrito às 02:45:16 UTC por `date -u`):
- Commits no `main`: `da2200c` (correção e instrumentação) e `2bee11a` (horários reais neste registro). Suíte, typecheck, build e `git diff --check` aprovados antes do push.
- Cloudflare: o check "Workers Builds" do GitHub liga `da2200c` à versão `3a3461c1-8bf6-43bb-9bd1-2b1761829507` (100% às 02:35:41 UTC) e `2bee11a` ao build `5eae7481` → versão `b664d1c7-7c5f-4421-8ae9-8d1d055d7b0e` (100% às 02:36:02 UTC), que contém o código de `da2200c`. Este registro gera um novo build só de documentação.
- `/health`: 200, `configured: true`. `bunker_ler` pelo MCP: revisão 5437, fontes `gzip-base64-v3` (72; 1,30 MB de 1,75 MB), sem pausa, nada devido, nenhuma execução pendente.
- Executor (`cloud-data` status): pulsos de 02:36:33 e 02:37:34 UTC, já na versão nova, terminaram `idle`; `lastError` vazio.
- Última falha registrada: `CLOUD_STEP_FAILED` às 02:22:54 UTC, causada pelo timeout de um `get snapshots` às 02:22:44, antes da migração. Ocorreu no código antigo e por isso não tem `storage` no histórico.
- `bunker_store` de 02:31:58 a 02:37:57 UTC: 100 chamadas, todas 200, p95 427 ms, máximo 975 ms. Comparando 01:30–02:31 com depois de 02:31:58: `get central` foi de 5 respostas 500 e p95 2.304 ms para nenhum 500 e p95 702 ms; `get snapshots` foi de 3 respostas 500 para nenhum 500 e máximo de 316 ms.
- A janela é curta e não comprova ausência de timeouts futuros.

Acompanhamento:
- Na janela das 06:00 (America/Sao_Paulo), conferir os 500 de `bunker_store` e o p95 por tamanho de pedido. Se houver falha, ler o campo `storage` em `lastFailure`.
- `daily` e `reports` ainda decodificam JSON; ficaram fora desta entrega porque nenhuma das falhas veio deles.

## Rodada de melhorias pedida pelo proprietário (registro escrito às 2026-11-07 02:52:22 UTC por `date -u`)

Escopo: quatro pontos derivados do que foi medido nesta sessão. Nenhuma coleta, campanha, agenda, pausa ou dado foi alterado.

1. Latência das leituras: resolvida pela migração `20261107023158`, sem mudança adicional. Todos os pedidos de maior custo em 24 h eram `get`:
   - 624 bytes: sinais com projeção `revision`.
   - 302 e 326 bytes: `live` e `creative` dos 6 projetos.
   - 82 e 86 bytes: um `live` e um `creative`.

   Comparação de 00:30–02:31 UTC com o período depois de 02:31:58:

   | Leitura | p50 | p95 |
   | --- | --- | --- |
   | `get central` | 313 → 139 ms | 4.626 → 519 ms |
   | `get snapshots` | 167 → 114 ms | 558 → 182 ms |
   | `live` dos 6 projetos | 225 → 97 ms | — |
   | um `live` | 93 → 48 ms | — |

   `resolutions`, `daily` e `reports` não estão entre os 15 maiores custos de 24 h; sem evidência para alterá-los.
2. Painel do executor (publicado no commit `a36d8ef`, versão Cloudflare `484b65d7-764c-466a-963d-397cf2fd76cf`, 100% às 02:56:07 UTC):
   - Mostra o diagnóstico de armazenamento saneado no histórico e a última falha registrada, mesmo depois de um passo bem-sucedido. Rótulos em `lib/storage-diagnostic-label.mjs`, só com vocabulário fixo e sem identificadores.
   - Corrige o modelo, que aparecia fixo como "Llama 3.3 70B" embora o executor use `@cf/openai/gpt-oss-120b`: o status do Worker passa a enviar `modelLabel` a partir de `cloud-model-policy`.
3. Persistência das coletas: confirmada sem correção. Os seis projetos têm 12/12 fontes completas (7d, 3d, ontem e hoje × campanha, conjunto e anúncio) via Malva MCP. Coletas de 06/11 entre 22:28 e 22:57 UTC; John às 00:28 UTC de 07/11.
4. Crescimento dos registros: banco com 78 MB. Dos 55 blobs `snapshots:` (06/11 16:20 a 07/11 00:30 UTC), só 1 é referenciado (pela central). Colaborações e sugestões não referenciam nenhum, e os 54 restantes somam 43,8 MB.
   - Ritmo observado: ≈5,5 MB/h durante a janela de coleta, porque cada coleta regrava o pacote inteiro de fontes (≈830 KB, já em gzip e incompressível no Postgres).
   - Nenhum código lê blobs antigos (só `lib/persistence.mjs` resolve a referência atual).
   - Nada foi apagado. Retenção é decisão do proprietário; opções: manter os N mais recentes ou um prazo em dias, ou mudar o formato para gravar fontes por projeto, alteração maior que exige preservar a compatibilidade `bunker-snapshot-reference`.

Validação: 940 testes, typecheck, build e `git diff --check` aprovados. O painel não foi conferido visualmente: a interface exige a autenticação privada do Site.

Conferência da publicação do painel (registro escrito às 2026-11-07 03:02:49 UTC por `date -u`):
- `/health` 200; `bunker_ler`: revisão 5437, fontes `gzip-base64-v3` (72), sem pausa, nada devido, nenhuma execução pendente.
- Primeiras leituras do status do executor (02:56:34–03:00:52 UTC) vieram ainda sem `modelLabel`. Desde 30/10/2026 a Cloudflare adia por padrão a troca de código de um Durable Object ativo (até 300 s ou até hibernar).
- Na leitura de 03:02:33 UTC o objeto já estava no código novo: `"modelLabel":"Workers AI gpt-oss-120b"`, último pulso `idle`, `lastError` vazio.
- Regra operacional: conferir mudanças do `BunkerCloudExecutor` só depois de 5 min do deploy; uma leitura anterior pode vir do código antigo. Referência: https://developers.cloudflare.com/durable-objects/deployments/durable-objects-code-updates/

## Aba Cards de decisão mais prática (registro escrito às 2026-11-07 03:20:16 UTC por `date -u`)

Pedido do proprietário: a aba não estava prática. Ele marcou os quatro problemas: demora para decidir, texto demais, dificuldade de comparar campanhas e colunas ruins.

- **Lista como visão padrão** (`lib/decision-list.mjs`, testado): uma linha por campanha, ordenada por etapa (Para aprovar → Sugestão da equipe → Revisão) e, dentro da etapa, pelo maior gasto de hoje.
  - Colunas: etapa, sugestão, gasto e front de hoje, ROAS e front de 3d, diário.
  - "Hoje" vem só da leitura atual (`liveToday`); leitura desatualizada é marcada e ausência continua N/D.
- **Decisão na própria linha**, sem o modal grande. A caixa de ação foi extraída do card (`ActionBox`) e é a mesma no modal e na lista, com as mesmas travas.
  - A aprovação de execução continua exigindo o diálogo de confirmação exata.
  - A Proteção da operação fica recolhida quando não há proposta exata (registrar intenção não executa) e abre sozinha quando há proposta para aprovar.
  - "Ver análise completa" abre o card inteiro.
- **Quadro mantido como alternativa** (seletor Lista/Quadro, lembrado por navegador): colunas cabem na largura e empilham em telas estreitas, sem rolagem lateral.
  - Cada cartão mostra 4 números; cenário, tendência, pareceres e fontes ficam em "Mais contexto".
  - O aviso "Atualizar análise" continua visível.
  - Título, lista e quadro ganharam o mesmo recuo dos filtros.
- **Conferência visual:** página temporária local com dados de exemplo, em 800 e 1440 px; a página não foi commitada.
- **Validação:** só estes arquivos, numa worktree limpa a partir de `d112cee`: 944 testes, typecheck e build aprovados.
- **Pendência alheia:** no checkout principal há edições não commitadas de outro escritor (`lib/learning-cycle.mjs`, `lib/learning-peer-review.mjs`, `lib/automatic-agent-hypotheses.mjs` e `tests/learning-peer-review.test.mjs`). Com elas, 8 testes de `cloud-executor` e `cloud-model-policy` falham com `CLOUD_LEARNING_REVIEW_REQUIRED`. Essas edições não foram commitadas nem alteradas.

## Crítica entre agentes antes da medição (registro escrito às 2026-11-07 03:28:07 UTC por `date -u`)

Pedido do proprietário: Nina e Theo pareciam parados no painel "Aprender, conferir e melhorar"; eles precisam interagir.

- **Diagnóstico (leitura via `bunker_ler`/`learningRead`):** Nina e Theo concluíam as etapas de todas as rodadas e registravam hipóteses próprias, mas o painel só mostrava rótulos fixos. A revisão entre agentes só começava com resultado medido, e os 56 padrões estavam "Em estudo" sem nenhum resultado medido. Por isso não havia o que revisar.
- **Mudança (commit `eaf11ad`, versão Cloudflare `460eb608`, deploy automático às 03:26:51 UTC):**
  - Sem resultado medido, a etapa normal de Lia, Nina ou Theo recebe uma hipótese "Em estudo" de outro papel (ou sem autor) para confrontar com os dados atuais. Não há chamada extra ao modelo.
  - Só `challenge` ou `inconclusive`; o autor nunca critica a própria hipótese.
  - A crítica fica registrada à parte (`phase: hypothesis`): não muda o estágio, não conta para apoio, não trava a revisão automática do autor e é recusada quando já existe resultado medido.
  - Limites: uma por papel e fingerprint, no máximo 15 por projeto (≈90 registros e ≈70 KB na central).
  - Crítica ausente na resposta do modelo não falha a análise da campanha; a revisão de evidência medida continua obrigatória.
  - O painel mostra, por agente, hipóteses próprias, críticas feitas e o que aguarda a próxima etapa, além das críticas recebidas em cada padrão.
- **Pendência alheia acima resolvida:** os 8 testes de `cloud-executor` e `cloud-model-policy` que falhavam com `CLOUD_LEARNING_REVIEW_REQUIRED` passaram depois que a crítica prévia virou opcional. Validação antes do push: 949 testes, typecheck, build e `git diff --check`.
- **Conferência pós-deploy:** `/health` 200; MCP `initialize`, `tools/list` (9) e `bunker_ler` com 200; secrets preservados (somente nomes conferidos); 156 críticas elegíveis, nenhuma feita ainda; executor ativo, sem falhas desde 03:00 UTC.
- **A conferir:** a primeira crítica real só ocorre na próxima janela (06:00 America/Sao_Paulo). O painel não foi conferido visualmente.
- **Fora desta etapa:** execução autônoma via Malva sem aprovação exata do dono não foi implementada; exige mudança de política escrita, com limites, e revisão.

## Rotina do dia e teto de resposta entre agentes (registro escrito às 2026-11-07 11:32:37 UTC por `date -u`)

- **Bateria de uso diário** (Bunker real em modo leitura e Bunker local com dados fictícios): o Site privado `chatgpt.site` roda uma versão anterior à lista de cards (`56b1b54`). Deploys pela `main` atualizam só o Worker; para o dono ver as melhorias, o Site precisa ser republicado. Outros gaps: fila de 450+ cards quase toda "Investigar", métricas sem comparação, tabela sem hoje/ontem nem ordenação, seleção esquecida, perguntas aos agentes só pelo Escritório.
- **Entrega 1** (commit `a92500e`, versão Cloudflare `89ee7627`):
  - "Hoje em 1 minuto" compara ROAS/ROI/CPA de hoje com ontem e 7 dias, só por índices.
  - "O que fazer agora" mostra até 5 campanhas ativas por dinheiro em jogo: 3 perdas e 2 oportunidades.
  - Testes com menos de 24h de entrega (ou sem início conhecido e sem janela fechada) ficam fora e são contados.
  - Tabela de Campanhas com gasto e ROAS de hoje/ontem, ordenação, filtro "Ativas" e título corrigido.
  - Projeto e período lembrados por navegador.
  - Só apresentação; conferida localmente em desktop e 375 px.
- **Falhas do executor lidas** pela seção `context` do envelope `review-data`, entre 09:13 e 10:12 UTC:
  - 9 `CLOUD_MEMORY_REVIEW_EVIDENCE` (já ocorria antes da crítica prévia).
  - 5 `CLOUD_AI_INVALID`, 4 delas do Cai, que não recebe crítica. Duas foram cortadas no teto de 4.400 tokens (`finishReason: length`) ao responder perguntas.
  - 3 `CLOUD_CAMPAIGN_READING_EVIDENCE` (`child_citation_required`, Nina/Nico).
- **Correção:** a resposta a uma pergunta entre agentes usa o teto de saída das etapas (6.400 no gpt-oss-120b, 3.200 no legado). Chamadas avulsas mantêm o teto menor. Entrada, validações, aprovação e execução não mudam.
- **Pendências:**
  - Republicar o Site.
  - Investigar com o Codex as falhas de evidência de memória e de citação de filhos.
  - Acompanhar se os cortes por tamanho desaparecem nas próximas respostas do Cai.

## Atividade dos gestores e evolução nos cards (registro escrito às 2026-11-07 12:02:00 UTC por `date -u`)

- **Pedido do dono:** os cards devem acompanhar a evolução das métricas e o log dos outros gestores. Se alguém agir antes ou durante a sugestão, isso deve ficar evidente, com % e de quanto para quanto. A Visão geral deve somar a atividade recente por ação, com nomes, e abrir o log ao clicar.
- **Fontes, sem inventar autor:**
  - histórico de edições Malva (`decisionHistory`): autor e horário exatos;
  - leituras completas que observaram mudança (`campaignChanges`): sem autor, com o intervalo entre as leituras;
  - execuções do Bunker confirmadas: "Bunker · aprovado por você";
  - acompanhamento ao vivo (`liveDrift`) ainda não registrado em log.
  A mesma transição em várias fontes vira uma linha, com a fonte mais rica e "confirmado também por".
- **Tela:**
  - **Card do quadro, linha da lista e card completo:** o aviso "Mudou depois da análise: quem/ação · −30% · R$ 1.000 → R$ 700/dia · horário"; a evolução de hoje desde a análise (gasto, front, ROAS antes → agora); o log "Atividade na campanha · últimas 72h".
  - **Linha recolhida da lista:** selo "Reduzida −30% após a análise".
  - **Análise da campanha:** mesmo log.
  - **Visão geral:** "Mudanças de orçamento e status", com caixas Aumentos/Reduções/Pausas/Ativações, contagem, nomes e quantas sem autor informado, em 24h ou 7 dias. Clicar abre o log com quem, data/hora, campanha e de → para.
- **Arquivos:** `lib/campaign-activity.mjs` (testado; log em cache por versão do estado e indexado por campanha), `app/campaign-activity.tsx`/`.css`, integrações em `app/decision-cards.tsx` e `app/bunker.tsx`.
- **Limites:**
  - "tempo real" segue a cadência existente: acompanhamento visual em minutos, leituras de análise na agenda;
  - o autor só aparece quando o histórico Malva foi importado; a política atual renova esse histórico por escopo a cada 24h;
  - mudanças vistas só na leitura ficam "autor não informado".
- **Validação:** 960 testes, typecheck e build. Conferido localmente com leituras fictícias que geraram aumento, redução e ativação.
- **O Site `chatgpt.site` continua em versão antiga até ser republicado.** Os deploys pela `main` atualizam o Worker.

## Sincronização das atualizações do Claude — 07/11/2026, 12:12 UTC

Esta conferência substitui a pendência de republicação do Site registrada acima. Os ajustes funcionais já estavam commitados no GitHub até `91e96f57b0d4077f3fcfa39768b456eb001eef57`; o check Workers Builds confirmou a versão Cloudflare `549857f2-f59f-4aa8-ac0b-29cf2df0a54c`, com 100% do tráfego. Não havia código funcional pendente de commit. A configuração compartilhável de preview `.claude/launch.json` foi revisada, sem credenciais, e incluída no registro desta entrega; `.mcp.json` e configurações locais de autenticação continuam fora do Git.

Inventário dos ajustes desde a correção de persistência:
- Painel do executor com diagnóstico de armazenamento preservado e o nome real do modelo (`a36d8ef`).
- Cards em lista por prioridade, decisão na própria linha, contexto recolhido e quadro como alternativa (`56b1b54`).
- Crítica entre agentes sobre hipóteses ainda sem medição, separada da validação de resultados e sem aprovar execução (`eaf11ad`).
- Resumo “Hoje em 1 minuto”, até cinco prioridades, tabela de campanhas com hoje/ontem e ordenação, além da seleção de projeto/período lembrada (`a92500e`).
- Respostas entre agentes com o teto de saída das etapas, preservando as validações de evidência (`dc414c8`).
- Atividade dos gestores e evolução das métricas nos cards, com autor quando fornecido pela fonte, percentuais, valores antes/depois e resumo por ação (`91e96f5`).

O Site privado foi sincronizado a partir dessa fonte e publicado com sucesso na **versão 128**, commit do repositório Sites `82ca8773c8f65bc6a97fa9a88540d081041c56ca`, deployment `appgdep_6aef153458a08191a84bc48a4fc794d7`. URL: https://bunker-trafego-erik.eriksozo.chatgpt.site/ . Acesso exclusivo do proprietário e configuração de runtime preservados (revisão 1, gateway para a mesma base Supabase, MCP disponível). A automação antiga do Sites permaneceu desativada.

A árvore de publicação preserva todos os arquivos funcionais do GitHub. Adaptação necessária apenas para hospedagem: o build privado mantém `sites()`/autenticação ChatGPT e não força `BUNKER_DEPLOY_TARGET=cloudflare`; isso está documentado em `docs/connections.md` do repositório Sites. O Worker principal conserva seu build externo e continua como único executor automático.

Validação: 960 testes, typecheck e build aprovados tanto no checkout principal quanto na preparação do Site. Após recarregar a página privada, a leitura autenticada da interface confirmou “Hoje em 1 minuto”, “Mudanças de orçamento e status” e a lista de cards com decisão inline. O MCP `bunker_ler` respondeu sem erro, revisão 5873 nesta conferência. Não foram registradas decisões nem executados comandos de campanha nesta publicação. A atualização da interface não elimina fontes vencidas, falhas de evidência ou limites de atualização já registrados para investigação.


## Hoje na atividade e decisão inline no resumo — 07/11/2026

Escopo pedido pelo dono: filtro Hoje em Mudanças de orçamento e status, preservando 24 horas/7 dias; e manter/aumentar/reduzir/pausar diretamente ao expandir uma campanha em O que fazer agora.

- Hoje filtra pela data civil no fuso confirmado por fontes Malva completas do projeto. No consolidado ou sem fuso único válido, usa America/Boa_Vista, explicitado na tela. Horários do log seguem o mesmo fuso. Virada do dia e DST testados; janela móvel de 24h continua como seleção inicial.
- O resumo expande no próprio local e reutiliza o controlador, ActionBox, checagens, IDs idempotentes e diálogo de aprovação exata dos cards. O alvo é a identidade exata projeto + conta + campanha, nunca busca textual. Análise completa é opcional; decidir não navega para outra seção.
- Intenção continua distinta de aprovação. Mudança de cenário invalida a aprovação anterior e avisa no editor. Decisão confirmada sai da fila compartilhada; falha de resposta mantém a conciliação já existente no histórico.
- Claude via Cursor foi tentado como escritor principal, mas a sessão OAuth expirou e não renovou. Codex concluiu esta alteração delimitada sem mudar credenciais, políticas financeiras, agenda ou campanhas.
- Validação: suíte de 963 testes, typecheck e build aprovados. Controle de navegador indisponível em duas tentativas; nenhuma captura ou decisão real usada como teste. Publicação da mesma fonte prevista para Cloudflare e Site privado.

## Bunker para Mac — notch e barra de menus (registro escrito às 2026-11-07 14:02:22 UTC por `date -u`)

- **Pedido do dono:** o Bunker no Mac "como o coucou", com tudo visível. Conexão escolhida: credencial própria só de leitura.
- **Servidor** (commit `8906e9b`, versão Cloudflare `cf1f6704`):
  - `GET /api/companion` devolve um resumo compacto: hoje vs ontem/7d, o que fazer agora, propostas aguardando o dono, atividade dos gestores com quem/quando/de → para, últimas conclusões dos agentes e status do executor.
  - Aceita a sessão do dono ou `BUNKER_COMPANION_TOKEN`, este só nessa rota GET. O bearer é removido no repasse e o cabeçalho `x-bunker-companion` forjado é apagado em todas as rotas.
  - Em produção, a credencial do app recebe 401 em `/mcp`, `/api/state`, `/internal/storage` e POST.
- **App** (`mac/BunkerNotch`, SwiftUI/AppKit, montado com as Command Line Tools por `mac/build.sh`):
  - Ilha sobre o notch que abre ao passar o mouse, item na barra de menus e avisos de novas aprovações, mudanças de gestores e perdas.
  - Instalado em `~/Applications/Bunker.app`, assinado localmente.
  - A credencial foi importada uma vez para as Chaves (`com.eriksozo.bunker.notch`) e o arquivo foi apagado.
  - Sem XCTest/macros nas CLT: as verificações rodam em `Bunker --self-test` e o build recusa instalar se falharem.
- **Coucou:**
  - Estudada a técnica de janela do notch no código MIT (crédito em `mac/NOTICE.md`).
  - Nenhum ativo de marca usado: nome, Mochi, ícones e sons.
- **Validação:** 967 testes, typecheck e build; self-test do app. Rota conferida com dados reais: 6 projetos; em 24h, 96 aumentos, 9 reduções, 79 pausas e 33 ativações, com nomes vindos do histórico Malva.
- **Pendências:**
  - Conferência visual do notch pelo dono (a captura de tela não está liberada para o Claude).
  - Aprovar no notch exige login de dono (segunda etapa).
  - Executor com 8 falhas na última hora no momento da leitura.

## Autoria das mudanças e incidente de carga na central (registro escrito às 2026-11-07 14:43:07 UTC por `date -u`)

- **Autoria:** o executor consulta, só leitura, o histórico de edições Malva (`tracking_ad_changes`, mesmos validadores da coleta) para campanhas com mudanças observadas sem autor nas últimas 72h.
  - Até 6 campanhas a cada 3 minutos; casa a mesma transição na janela da observação.
  - Guarda quem fez e a hora exata no armazenamento do próprio executor (7 dias, teto de 3.000; nova tentativa em 6h se não achar). Nada vai para a central nem para `decisionHistory`, que tem teto fixo de 5.000.
  - Expostos em `GET /api/attribution` (dono) e no resumo do app do Mac; o log de atividade junta isso à mudança observada.
  - Primeira rodada real (14:39 UTC): 6 campanhas, 6 de 6 autores encontrados, 335 eventos lidos, 0 falhas. Diagnóstico em `attribution` no status do executor.
- **Incidente:** de 14:05 a ~14:38 UTC, todo pulso do executor falhou com `get central` em timeout de 30 s.
  - Coincidiu com a rota do app do Mac lendo a central inteira a cada minuto e com a autoria lendo mais uma vez.
  - Somou-se o Site `chatgpt.site` (versão antiga) consultando a cada 2 s por aba: 68 de 77 chamadas a `/internal/storage` canceladas em 70 s. Havia uma aba do Claude aberta, que foi fechada.
- **Correções** (commits `d1f36ea` e `8305994`, versão `02b49885`):
  - A autoria reaproveita a leitura do acompanhamento ao vivo.
  - O executor monta os resumos do app do Mac a partir da leitura que já fez, e `/api/companion` lê só essa cópia (503 "em preparação" se não houver); o app consulta a cada 2 min.
  - O envelope MCP `cloud-data` não lê mais a central.
  - Às 14:42 UTC: coletas e etapas sem falha.
- **Pendência:** o Site antigo ainda consulta a central a cada 2 s por aba aberta. Republicar o Site ou usar o Worker reduziria essa carga. Investigar com o Codex se os timeouts voltarem.

## Notch: comportamento revisado (registro escrito às 2026-11-07 14:48:26 UTC por `date -u`)

- **Bateria no app anterior:**
  - O mouse abria o painel grande por acidente.
  - O seletor de projeto fechava junto com o painel quando o mouse saía da ilha.
  - Não havia teclado.
  - O monitor externo é a tela principal, então o notch ficava fora de vista.
  - Nada chamava atenção no notch.
  - "Em preparação" aparecia como erro.
  - Consumo em repouso: 0,2% de CPU, ~82 MB.
- **Mudanças** (técnicas do Coucou MIT, crédito em `mac/NOTICE.md`):
  - Máquina de estados pura (`IslandFSM`): passar o mouse só espia; clique ou ⌥⌘B abre e fixa; Esc, clique fora ou 45 s sem uso fecham.
  - Avisos de nova proposta, perda ou mudança de gestor expandem o notch por 6 s, numa fila de até 3.
  - Atalho global ⌥⌘B por Carbon.
  - Teclas 1 a 4 trocam de aba.
  - Escolha de tela (notch, principal, mouse) na barra de menus.
  - A verificação do mouse roda a 30 Hz só perto da ilha (5 Hz no resto).
  - "Em preparação" virou um estado neutro.
  - O aviso de autor que chega depois tem identidade estável e não repete o alerta.
- **Validação:**
  - `Bunker --self-test` cobre a máquina de estados, a cadência, a escolha de tela e a identidade estável.
  - Consumo em repouso: 0,0% de CPU, ~51 MB.
  - A conferência visual do comportamento fica com o dono.

## Notch: projetos, detalhe da campanha e ajustes pelo card (registro escrito às 2026-11-07 15:00:57 UTC por `date -u`)

- **Commit `d06678b`, versão `292e1d46`:**
  - Aba Projetos (placar do dia por projeto, calculado uma vez por pulso pelo executor).
  - Detalhe da campanha no notch: janelas, orçamento, status, sinal e últimas mudanças com autor.
  - Letreiro no notch fechado.
  - Não perturbe (1 h ou até 8 h do dia seguinte).
  - Web aceita `#cards?project=<id>&q=<campanha>`.
  - O resumo leva o ID interno Malva da campanha (`malvaObjectId`).
- **Ajustes pelo notch, escolha do dono** ("Card do Bunker no notch"):
  - O botão "Ajustar aqui" abre o próprio card do Bunker (Worker) dentro do notch, com a sessão de dono do app: mesmos botões, travas, confirmação exata e despacho único. Nenhuma credencial nova com poder financeiro.
  - Só carregam o Worker e o verify do Supabase; o Site `chatgpt.site` é trocado pelo login por e-mail; o resto abre no navegador.
  - O login é feito colando o link do e-mail (só o callback do Bunker ou o verify do Supabase são aceitos).
  - Com o card aberto, o notch não intercepta teclas.
  - Regras cobertas no `--self-test`.
- **Pendências:**
  - Link direto da campanha na Malva: a API pública não expõe a URL de tela, e falta um exemplo real do dono para montar o formato.
  - Conferir o primeiro login e um ajuste real com o dono.


## Continuidade do primeiro login no notch — 07/11/2026

Última tarefa real da sessão Claude 9ad6ce4f: conferir o envio do e-mail de acesso; interrompida pelo limite semanal do Claude. O commit 77ca955 mostrava um motivo genérico de rate limit, mas não concluía o primeiro acesso.

- Logs Auth do Supabase Bunker Traffic confirmaram 429 over_email_send_rate_limit em tentativas repetidas com 59/39 segundos de intervalo mínimo. Houve também envio aceito anteriormente e um erro transitório de consulta cancelada. Leitura de auth.users ainda não mostrava confirmação de e-mail nem primeiro login nesta conferência; isso não foi alterado artificialmente.
- Correção: respeitar Retry-After ou os segundos informados pela Supabase; sem prazo informado, não afirmar espera exata de uma hora. Formulário bloqueia duplo envio, mantém espera no sessionStorage, oferece reenviar manualmente e não dispara sozinho. Resposta de sucesso é pedido aceito, não entrega confirmada. Códigos de erro passam por allowlist de formato; conteúdo bruto do fornecedor não entra no log.
- App Mac: após login, volta ao card exato que estava aberto. Recarregar usa a página atual e não reproduz um link de e-mail de uso único já consumido. Link colado recusa credenciais na URL, porta e prefixos de caminho que apenas imitem /auth/v1/verify. Cookies continuam próprios e persistentes do WKWebView; token de leitura não vira identidade de dono.
- Validação: testes Auth e do contador/reload, suíte completa, typecheck/build e self-test nativo. O proprietário foi solicitado a colar o link recebido no notch, sem enviar credenciais no chat. Gmail MCP indisponível nesta sessão; leitura de envio não comprova recebimento nem sessão iniciada. Nenhuma campanha alterada.

- Conferência nativa revelou que Referrer-Policy:no-referrer no formulário produzia Origem inválida no WKWebView. A página de e-mail usa same-origin para preservar o Origin da submissão sem divulgar a origem a outros domínios. A validação estrita de Origin no backend permaneceu igual; origens nulas/estrangeiras não foram liberadas.

## Autoria de gestores na web e no notch — 07/11/2026

Correção solicitada pelo dono: nomes disponíveis no Malva não podiam permanecer ausentes nas duas interfaces.

- A consulta anterior dependia de mudanças captadas entre duas leituras, cobria seis campanhas por vez e guardava ausência de autor por seis horas. Uma alteração seguida de reversão entre leituras nem entrava nessa busca.
- O executor agora lê o histórico recente de orçamento/status de campanhas por projeto Meta configurado, incluindo campanhas fora da fila e mudanças entre observações. Rotação de dois projetos por pulso existente, página atual mais uma página de continuação, retenção de sete dias e teto de 3.000 registros no próprio Durable Object. Cursores, falhas e limite permanecem explícitos; não grava fontes financeiras nem aumenta a cadência do executor. Respeita pausa.
- Normaliza `daily_budget` e status minúsculos do Malva. Nomes técnicos/chaves não viram nomes de gestores. A união privilegia o nome disponível do mesmo evento e preserva transições repetidas de eventos diferentes; conta, projeto, moeda e intervalo observado precisam conferir.
- Web, detalhe expandido da visão geral e resumo do notch usam a mesma atividade enriquecida. O card expandido da visão geral antes recebia o estado sem essa autoria.
- Testes incluem paginação/continuação, identidade, datas inválidas, falha sem resultado parcial, ausência real de autor, transições repetidas e paridade web/notch. Conferência somente leitura com uma amostra real de eventos humanos: nenhum nome divergente/ausente após a transformação; somatórios web/notch iguais. As fixtures do repositório usam identificadores e valores sintéticos. Os dados desse teste real ficaram fora do Git.
- Isso não garante atualização instantânea da origem. Produção precisa confirmar os projetos na cobertura do executor após deploy. Nenhuma alteração de campanha ou aprovação foi feita.

Conferência após a primeira publicação encontrou uma falha adicional: rejeição de parecer (`CLOUD_MEMORY_REVIEW_EVIDENCE`) abortava o restante do pulso, impedindo inclusive a atualização de autores. A falha da análise agora é registrada e o pulso continua nas leituras visuais/autoria/resumo, preservando pausa e prioridade das execuções no início. O teste executa o método `alarm` real com fronteiras de infraestrutura substituídas e cobre rejeição do parecer, pausa durante análise e falha isolada da autoria. O coletor também recusa um período devolvido que não corresponda aos dias pedidos.

A web privada também precisava da ponte: `/internal/storage` não aceitava o comando de leitura `cloudExecutor/attribution`, embora sua rota autenticada o solicitasse. Somente essa leitura foi adicionada à allowlist do gateway já autenticado; chamadas públicas e credenciais de agente/companion continuam recusadas no gateway. Teste cobre encaminhamento, recusas e comando arbitrário. A publicação Sites preserva a audiência exclusiva do dono e o build próprio, ligado ao mesmo executor.

QA da web identificou um agregado sem autor: uma única diferença entre leituras era, na origem, a soma de dois ajustes de orçamento consecutivos com gestor e horários distintos. A apresentação agora substitui o agregado pela sequência real somente quando projeto, conta, moeda, campo, intervalo, encadeamento completo de valores e ordem temporal estrita conferem. Históricos incompletos/ambíguos mantêm o agregado sem atribuição; orçamento diário e vitalício não se confundem. É conciliação visual, sem editar observações originais nem atribuir por proximidade.

## 07/11/2026 — lançamento de testes com acompanhamento prioritário

Pedido do proprietário: aprender com o log nominal do gestor e não ocultar testes novos programados para o dia seguinte por proteção automática de 24h. `docs/test-launch-protocol.md` descreve o contrato. `test-launch.mjs` classifica indicação de primeiro dia com proveniência; nomes não confirmam programação. O resumo e o acompanhamento expõem testes novos sem vendas; o foco reserva duas posições prioritárias sem retirar duas de rotação. Contexto e instruções dos quatro analistas recebem a exceção de revisão antecipada. Dados atuais substituem os de hoje da análise antiga apenas para o sinal, sem renovar fontes ou aprovação.

Estudo rastreável registrado no aprendizado privado do John, com pausas e contraexemplos de aumentos por conta/ID. Dados operacionais permanecem fora do Git público. O protocolo não cria teto universal, não altera cadência/pausa e não habilita execução sem aprovação exata. Testes de regressão cobrem cópias por conta, vencedores, dados ausentes, virada de fuso, histórico rentável, fonte vencida e fila/foco. Nenhuma campanha alterada nesta manutenção.

## Testes novos sem vendas — triagem de 07/11/2026 e lacuna do primeiro gasto (registro escrito às 2026-11-07 19:12:57 UTC por `date -u`)

- **Triagem somente leitura** (6 agentes Claude, Malva MCP, sem escrita): John, Leandro, Murilo e Nico; Gabe e Ronald pausados pelo dono (Gabe sem gasto Meta desde 26/10). A lista por conta/campanha foi entregue ao dono no chat; dados operacionais ficam fora do Git.
- **Cards:** proposta exata só nasce na rodada do executor (ops com claim e três conclusões reais); Claude não reservou etapas para não disputar o executor. A rodada John `55ca0b27` já priorizou dois testes novos sem vendas e os quatro papéis os marcaram "investigar". O foco ordena por revisão mais antiga, então os demais entram nas próximas rodadas (duas vagas prioritárias por rodada).
- **Lacuna corrigida:** as janelas fechadas são coletadas com `status:'spent'`; um teste realmente novo nunca tem linha nelas, então o caminho `first-spend-unconfirmed` do `testLaunchContext` era inalcançável e só o nome com a data de hoje marcava o primeiro dia. `verifiedNoSpendPeriods` aceita a ausência apenas em fonte Malva completa, única, do mesmo projeto, que termina no início de hoje e foi lida/sincronizada depois disso; os cinco chamadores (foco do executor, contexto dos analistas, cards, resumo diário e acompanhamento) passam esses períodos. Evidências passadas ao modelo não mudam. Nos dados de hoje todos os testes novos tinham "07/11" no nome, portanto a correção não destravou um caso observado; cobre o teste nomeado na véspera e programado para o dia seguinte.
- **Validação:** 1007 testes, typecheck, build e `git diff --check`.
- **Pendências:** `decisionRead` do John respondeu "Tempo esgotado no armazenamento" às ~19:12 UTC; a central estava em 1,65 MB de 1,75 MB (94%). Conferir antes da próxima janela.

## Incidente de disco no Supabase, conta no notch e fila sem campanhas já pausadas (registro escrito às 2026-11-07 19:40:07 UTC por `date -u`)

- **Incidente:** de ~19:11 a 19:34 UTC o Postgres não aceitou conexões estáveis. O checkpoint levou 38,7 s para gravar 1 buffer e o arquivamento do WAL falhou; todo `bunker_store` voltou 500 por timeout. O ritmo de gravação era ~60 MB a cada 15 min (~240 MB/h) desde pelo menos 14:30, sem pico: sintoma compatível com esgotamento do orçamento de I/O de disco (não confirmado no painel). O dono redimensionou o compute; o banco voltou às 19:34:04 UTC (parâmetros observados: shared_buffers 256 MB, effective_cache_size 768 MB, 60 conexões). Depois disso: 200 em todas as chamadas, p95 0,3–0,7 s, central na revisão 6553. Reduzir o volume de gravação continua pendente e exige decisão do dono.
- **Notch:** a conta passa a aparecer no rótulo de cada linha de "O que fazer agora" (`Format.queueTag`, self-test). Commit `23a73bb`, app reinstalado.
- **Fila sem campanhas pausadas depois da análise:** a fila lia o status da última análise completa; um teste pausado pelo dono às 19:07 UTC continuava listado. `pausedAfterAnalysis` usa o status mais recente de registro posterior à análise (log de gestores com autor/hora, mudança observada e, na web, leitura ao vivo) para tirar a campanha da fila; reativação posterior a devolve. Mesmo projeto + conta + ID; campos de orçamento não contam. Web e notch usam a mesma regra.
- **Validação:** 1009 testes, typecheck e build.

## Autonomia em fase sombra (registro escrito às 2026-11-07 20:22:16 UTC por `date -u`)

- **Decisão do dono:** sombra de 3 a 5 dias; regras elegíveis para execução futura: pausar teste novo sem venda, reduzir 20% em dia ruim, pausar campanha sem entrega e aumento com teto (padrão de aumento observado); sem limite diário; o Bunker cuida dos testes D0–D1; avisos só ao dono. Política: `docs/autonomy-policy.md`; linha correspondente no `CLAUDE.md`.
- **Implementação:** `lib/autonomy-shadow.mjs` (regras puras, testadas com dados sintéticos); o executor avalia a cada pulso com a central e a leitura ao vivo já obtidas, guarda em `shadow:*` no Durable Object (7 dias, teto 3.000; grava só o que mudou) e casa cada decisão com a ação posterior de um gestor no mesmo objeto. Leitura pelo MCP `cloud-data` `{"action":"shadow"}` e bloco "Sombra do Bunker · hoje" no notch. Nada é proposto, aprovado ou enviado.
- **Limiares** ficam no secret `AUTONOMY_SHADOW_POLICY` (fora do Git). Aumentos aparecem como bloqueados até o dono definir tetos.
- **Validação:** 1019 testes, typecheck, build e self-test do app.
- **Próximo:** revisar a sombra com o dono em 3 a 5 dias (acertos, vencedores que seriam cortados, aumentos que piorariam, antecedência sobre os gestores).

## Painel de contas com limite diário da Meta (registro escrito às 2026-11-07 21:38:42 UTC por `date -u`)

- **Pedido do dono:** parar de atualizar à mão o limite de gastos diário das contas no quadro "PLANEJAMENTO DE CONTAS 2026" (quadro branco do Malva, que não aceita escrita por integração). O Malva tem o campo `dailyLimit`, mas vazio em todas as contas conferidas. Caminho escolhido: painel no Bunker + token Meta próprio, somente leitura.
- **Implementação:** `lib/account-limits.mjs` junta `tracking_ad_accounts` (por projeto configurado) com `/me/adaccounts` (`adtrust_dsl` e gasto de hoje na moeda da conta); dados pessoais do Malva ficam fora. O executor monta a cada 30 min e guarda no Durable Object. Aba web "Contas de anúncio" (`#accounts`, rota `/api/accounts` de dono), aba "Contas" no notch e leitura MCP `cloud-data` `{"action":"accounts"}`. Regra do token em `docs/connections.md` e no `CLAUDE.md`.
- **Sombra:** já registrando (35 decisões às 21:34 UTC). A regra "sem entrega" agora ignora campanhas com data de hoje ou de ontem no nome.
- **Pendente:** o dono criar o token (`ads_read`) e cadastrar `META_ACCOUNTS_TOKEN`; conferir a unidade de `adtrust_dsl` contra o Gerenciador numa conta conhecida.

## Bunk, mascote do notch (registro escrito às 2026-11-07 21:55:19 UTC por `date -u`)

- **Pedido do dono:** um avatar interagindo, chamado Bunk. Personagem original (cúpula de bunker, visor, antena); o Coucou foi consultado só pela licença: código MIT, mas nome, personagem, expressões, animações e sons do Mochi são protegidos e não foram usados.
- **Comportamento:** humor espelha a operação (vigiando com pulso recente do executor; alerta com perda, proposta aguardando ou conta perto do limite; feliz com ROAS acima de ontem; dormindo fora das 06h–20h, pausado ou silenciado; pensando com resumo em preparação; preocupado em erro). Hover olha para o ponteiro; clique fala o próximo assunto mais importante num balão. Respeita "reduzir movimento". `Bunker --render-bunk arquivo.png` gera a folha de humores.
- **Validação:** self-test do app (humor, falas, horário). Conferência visual da folha renderizada; o comportamento ao vivo no notch fica com o dono.

## Detalhe da campanha no notch: janelas fechadas sem gasto (registro escrito às 2026-11-07 22:02:08 UTC por `date -u`)

- **Pedido do dono:** testes novos mostravam N/D em Ontem, 3 e 7 dias no detalhe do notch. Causa: as fontes fechadas guardam só linhas com gasto, e uma campanha que começou hoje não aparece nelas.
- **Mudança (commit `da8d9f7`, versão Cloudflare `161b767a`):** `lib/companion-summary.mjs` usa o `noSpendPeriods` já verificado (`verifiedNoSpendPeriods`: fonte Malva completa, terminando onde hoje começa, lida e sincronizada depois). Nesses períodos o notch mostra "sem gasto" e gasto zero; pedidos, ROAS e ROI continuam N/D (fonte só de gasto não observa vendas). Qualquer outra ausência continua N/D. App do Mac reinstalado (`mac/build.sh`, self-test ok).
- **Pendente:** conferir no notch após o próximo resumo do executor.

## Notch: decisões do dono com Touch ID (registro escrito às 2026-11-07 22:10:52 UTC por `date -u`)

- **Pedido do dono:** ajustar campanhas direto do notch sem o login por link de e-mail. Escolhas dele: confirmação por Touch ID; ajuste criado no notch **passa pela equipe** antes de executar.
- **Servidor:** `lib/owner-device.mjs` (verificação ECDSA P-256 com a chave pública `BUNKER_OWNER_DEVICE_KEY`), ramo em `lib/cloudflare-auth.mjs`, rotas `app/api/companion/owner` (só `cardDecision` e `proposalReview`, mesmas regras da web) e `app/api/companion/cards` (leitura), `lib/companion-cards.mjs`. Testes em `tests/owner-device.test.mjs`. Detalhes em `docs/connections.md`.
- **App:** `OwnerKey.swift` (Secure Enclave), `OwnerCards.swift`, `OwnerAdjustView.swift`. "Ajustar aqui" e "Conferir" das propostas abrem a tela nativa: escolha (aumentar/reduzir com %, pausar, manter) vira pedido para a equipe; propostas "Aguardando aprovação" mostram antes → depois e "Aprovar com Touch ID". O prompt do Touch ID mostra a mudança exata. O card web segue disponível pelo navegador.
- **Interop conferida:** envelope assinado pelo Swift verificado pelo verificador Node; self-test nativo cobre limites de %, centavos, intenção sem aprovação e assinatura.
- **Pendências:** primeiro uso real com a digital do dono (não testável por agente); nenhuma campanha alterada nesta entrega.

## Bunk fora do notch: passeio, desktop e telas escolhidas (registro escrito às 2026-11-07 22:16:38 UTC por `date -u`)

- **Pedido do dono:** o Bunk deve invadir a tela e chamar a atenção quando algo pedir, percorrer as telas, ser mais participativo, com liga/desliga e escolha de telas; no notch o nome é Bunk (a web continua Bunker).
- **Comportamento:** proposta nova ou perda nova → passeio por todas as telas permitidas falando o aviso (perda no máximo a cada 5 min; proposta não espera); mudança de outro gestor → visita na tela do ponteiro (máx. a cada 15 min); dia calmo → passeio com resumo a cada ~40 min, só 06h–20h. Respeita "silenciar avisos". Pode morar no desktop (arrastar, posição lembrada, clique duplo ou soltar no notch volta). Clique fala o próximo assunto (durante o passeio abre o notch); botão direito: abrir no notch, o que está acontecendo, já vi, ficar/voltar, silenciar 1 h, guardar o Bunk. Dorme sem atividade (2 min, mouse longe), 10 fps dormindo, pausa com a tela dormindo.
- **Menu da barra → Bunk:** Bunk solto pelas telas, morando no desktop, chamar agora, Todas as telas / cada tela.
- **Código:** `BunkRoamLogic.swift` (regras e rotas puras, testadas em `BunkSelfTest.swift`), `BunkDesktop.swift` (janela e interação), reações próprias em `Bunk.swift`; mecânicas do Coucou (MIT) creditadas em `mac/NOTICE.md`, sem ativos dele.
- **Validação:** self-test do app; folha renderizada de humores e reações. O comportamento ao vivo nas telas fica para o dono conferir.

## Melhorias do notch a partir de projetos abertos (registro escrito às 2026-11-07 22:21:39 UTC por `date -u`)

- Pesquisa de projetos parecidos com o Coucou, com licenças, em `docs/notch-research.md`.
- Aplicado (ideias reescritas, créditos em `mac/NOTICE.md`): Bunk só anima quando há algo para ver (notch fechado parado em tranquilo, vigiando, feliz e dormindo; 10 fps dormindo); avisos em rajada viram um passeio; não passeia em tela com app em tela cheia (limites de janela, sem permissão de Gravação de Tela); realoca ao desconectar monitor; pausa com tela bloqueada; opção "Esconder notch e Bunk em gravações e calls" (desligada por padrão porque também some dos prints).
- Medição em repouso após instalar: 0,0–0,4% de CPU, ~60 MB.
- Próximos candidatos listados no documento (andar sobre janelas, rodízio por urgência, espiada com háptico, molas).

## Bunk sobre janelas e rodízio por urgência (registro escrito às 2026-11-07 22:28:25 UTC por `date -u`)

- **Bunk sobre janelas** (morando no desktop): fica na borda de cima da janela abaixo dele (larga o bastante, com espaço acima, não encoberta), cai com gravidade quando a janela fecha/move/minimiza, pousa com achatamento e passeia pela borda de vez em quando. Leitura de janelas só por limites/camada/dono (sem nomes, sem Gravação de Tela): rápida em movimento e após troca de app, lenta parado. `WindowPerch` testado no self-test.
- **Rodízio por urgência** no notch fechado (`UrgencyTicker`): propostas para aprovar, maior perda e contas no limite primeiro, em cor e com dobro de tempo; item urgente novo aparece na hora; dia calmo mantém ROAS, gasto e última mudança.
- Ideias do puck-mac e do CodeIsland (MIT), reescritas; créditos em `mac/NOTICE.md`.
- **"Já fiz no Gerenciador" no notch** (registro escrito às 2026-11-07 22:46:09 UTC por `date -u`): a tela de ajuste ganhou o botão "Já fiz no Gerenciador (Touch ID)", que envia `cardDecision` com `applied:true` (núcleo da outra sessão em 0a86e63: status "Aplicada pelo dono", nunca aprova nem executa). `companionCards` expõe `lastChoice.appliedByOwner`, `canReportApplied` e `verification` (A conferir / Conferida / Divergente pela próxima leitura completa do Malva). Teste `tests/owner-applied-companion.test.mjs`. Essas mudanças entraram no commit c3db506 da outra sessão, por índice Git compartilhado; os commits agora usam `GIT_INDEX_FILE` próprio. Deploy Cloudflare 6836c6f5; app reinstalado com o HEAD 2a61bee. Chave pública do Mac registrada no Worker pelo dono e conferida (assinatura falsa recusada com a chave reconhecida). Falta o primeiro uso com a digital do dono.

## "Já fiz no Gerenciador" pelo Bunk (registro escrito às 2026-11-07 22:46:14 UTC por `date -u`)

- **Pedido do dono:** quando o Bunk aponta uma campanha, clicar nele, ver o contexto da sugestão e informar o ajuste já feito (pausar, aumentar, reduzir, manter), com tudo sincronizando.
- **Núcleo (0a86e63, esta sessão):** `cardDecision` com `applied:true` grava "Aplicada pelo dono" (`appliedAt`); nunca aprova proposta nem conta como execução; pode suceder intenção da mesma ação. Conferência derivada em `lib/owner-applied.mjs` com a leitura completa de hoje posterior a `appliedAt`+60 s: Conferida, Divergente (volta para a fila) ou A conferir. Entra no log como "Você · informado no notch" e pede releitura ao vivo do projeto no próximo pulso (`liveRefreshRequests`).
- **Bunk (c3db506/2a61bee, esta sessão):** falas carregam a campanha; clique durante o aviso de perda, ou botão "Ajustar" no balão do notch, abre a ilha no ajuste daquela campanha (`notch.openAdjust`); proposta abre a lista.
- **Tela de ajuste (sessão "Ajuste de campanhas via notch"):** seção "Já fiz no Gerenciador" no `OwnerAdjustView`, envio assinado com Touch ID. Os arquivos dela entraram por engano no commit c3db506 (índice compartilhado); conteúdo testado, histórico mantido; as duas sessões passaram a usar índice próprio.
- **Pendente:** o envio assinado depende do secret `BUNKER_OWNER_DEVICE_KEY` no Worker (cadastro do dono); sem ele volta 503.

## Notch: ciclo de design system e UX (registro escrito às 2026-11-07 22:56:20 UTC por `date -u`)

- **Pedido do dono:** autoaprimoramento do design system, UI e experiência do notch, com pesquisa de projetos abertos. Um ciclo, fechado: renderizar, auditar, corrigir, renderizar de novo.
- **Ferramenta:** `Bunker --render-notch pasta` gera um PNG por estado e aba (repouso, espiada, aviso, abas, detalhe) com dados fictícios, sem rede e sem credencial (`NotchPreview.swift`, `Store.showPreview`).
- **Aplicado:** ilha com ombros côncavos e raios animados por estado (adaptado do DynamicNotchKit, MIT, aviso em `mac/NOTICE.md`); molas assimétricas (abre com leve elástico, fecha firme; fade com Reduzir movimento); conteúdo aberto com desfoque e escala pelo topo; rodízio com troca por desfoque; sombra por estado; um só botão de destaque por tela ("Abrir Bunker" ficou discreto); ponto do cabeçalho mostra frescor da leitura (não atenção); ROAS rotulado no detalhe e janelas sem gasto só com o que se sabe; etiquetas de projeto/conta neutras; tokens `DS.Font.micro`/`microStrong`, `Tone.tag`, `ActionButton`, `DS.Motion.island`.
- **Pesquisa:** `docs/notch-research.md` atualizado com licenças conferidas e próximos candidatos (pré-hover, háptico, deslizar para fechar).
- **Não verificado:** a animação ao vivo (molas, desfoque) só aparece no app; os PNGs mostram os estados parados.
- **Autor "Meta" nos estados que só a Meta define** (registro escrito às 2026-11-07 23:02:23 UTC por `date -u`): pedido do dono de sempre mostrar o autor. Transições de status para dentro ou fora de IN_PROCESS, PROCESSING, PENDING_REVIEW, IN_REVIEW, PREAPPROVED, DISAPPROVED, WITH_ISSUES ou PENDING_BILLING_INFO recebem `actor:'Meta'` e `automatic:true` (`metaSystemActor` em `lib/campaign-activity.mjs`, leitura observada e ao vivo; teste `tests/meta-system-actor.test.mjs`). O notch mostra esses estados em português. Pausa/ativação/orçamento sem registro no histórico Malva continuam "autor não informado": o autor não é inventado.
- **Notch: pacotes A–D da pesquisa de código aberto** (registro escrito às 2026-11-08 00:06:10 UTC por `date -u`). Pedido do dono: "Aplique todos os pacotes de A a D".
  - **A · menos interrupção:** dispensar perda até o estado mudar (outra faixa de ROAS, status, período, ou perda 1,5× maior), adiar 30 min/2 h/amanhã 8h (perda, propostas, contas no limite), silêncio em reunião (câmera/microfone em uso por CoreMediaIO/CoreAudio, sem permissão; Bunk fica em casa, avisos e notificações esperam a chamada acabar) e aviso automático de 4 s. Itens dispensados seguem nas listas, esmaecidos; saem do selo, do rodízio, da fala do Bunk e dos avisos. `Attention.swift`, `Presence.swift`, `Widgets.swift`.
  - **B · leitura do dinheiro:** `lib/budget-pace.mjs` (novo) entra em `/api/companion` como `pace`: gasto de hoje no ritmo atual contra os orçamentos diários ativos, por projeto e na moeda do projeto (taxa da própria linha; sem taxa e moeda diferente fica fora e conta como "sem orçamento"); N/D antes de 2 h de dia, sem orçamento ou com moedas diferentes em "todos". Notch: quarto cartão "Ritmo do orçamento", rodízio e espiada; minigráfico de ROAS 7d/3d/ontem/hoje (3d novo em `dailyComparison.recent`); idade do dado na espiada e "dados há X min" no rodízio após 10 min.
  - **C · robustez/energia:** hover sem consulta contínua do cursor (monitores de movimento + checagem a 20 Hz só com o cursor na ilha ou ilha aberta), abertura por intenção (empurrar a borda abre; senão 0,12 s parado; passagem lateral rápida reinicia); atualização 1 min aberta / 2 min recolhida / recuo até 15 min após falhas / pausa com tela bloqueada ou dormindo; telas do Bunk salvas por UUID (migração automática da lista antiga).
  - **D · acessibilidade:** VoiceOver anuncia avisos da ilha; Reduzir transparência tira desfoques e deixa o balão do Bunk opaco; Aumentar contraste reforça superfícies, bordas e texto secundário.
  - **Verificado:** `--self-test` ok (novos testes em `AttentionSelfTest.swift`), `npm test` 1041/1041, typecheck, build, app instalado; PNGs do `--render-notch` conferidos. **Não verificado ao vivo:** detecção de reunião numa chamada real e a sensação do hover por intenção (dependem do uso no Mac).
- **Ordem direta do dono no notch + nova tela "Sua decisão"** (registro escrito às 2026-11-08 00:26:03 UTC por `date -u`). Pedido do dono: "quando eu aprovar quero que tome ação via mcp malva direto na campanha, de pausa, aumento específico ou redução específica" e "melhore também o design system e UIX design dessa sessão". Decisão dele nesta sessão: "Ordem direta do dono"; confirmada na sessão "Ajuste de campanhas via notch": "Confirmo ordem direta" (substitui o "Sim, passa pela equipe" de mais cedo).
  - **Servidor:** `ownerOrderProposal` em `lib/collaboration.mjs` cria a proposta exata selada do round atual (`createdBy:'owner'`, `ownerOrder:true`, sem `opinionRefs`) e a aprova pelo dono. `recordOwnerChoice` aceita `ownerOrder:true`, que usa `card.actionable`, só vem do Mac (`mac-touchid:`) e substitui um "Pedir à equipe" pendente. `isManualDecision` deixa a ordem passar pela checagem ao vivo e pela contingência. `companion-cards` envia `orderActions` e `orderBlockers`. O executor pega a proposta "Aprovada" como qualquer outra. Testes: `tests/owner-order.test.mjs`.
  - **Notch:** "Executar agora" (Touch ID) é a ação principal quando pode rodar; se não, "Pedir à equipe" vira a principal e um quadro lista o que falta. Também entraram: faixa com as quatro janelas, segmentos com ícone, atalhos de %, quadro "Muda na Meta" (de → para e diferença por dia), "Já fiz no Gerenciador" como ação discreta e "Aprovar e executar" nas propostas da equipe. Visuais em `--render-notch` (11 a 13).
  - **Limite prático:** a ordem exige leitura de hoje com menos de 60 min (mesma regra dos cards). Com leitura vencida, o botão explica e o dono pode pedir à equipe.
  - **Não verificado ao vivo:** nenhuma ordem real foi enviada nesta sessão. O canal do Mac depende de `BUNKER_OWNER_DEVICE_KEY` estar cadastrado.
- **Sincronismo quase em tempo real com a Malva** (registro escrito às 2026-11-08 00:45:42 UTC por `date -u`). Pedido do dono: "sincronize em tempo real junto com o malva ... o momento em que tiver algum ajuste direto no malva acione imediatamente no bunker web e bunk".
  - A Malva não tem push para ajustes de campanha: os webhooks dela cobrem só vendas e conversões e são criados no painel. `workspace_activity` responde 403 para o papel desta conexão.
  - `lib/change-watch.mjs`: a cada 15 s o executor pede `tracking_ad_changes` (hoje, `who:people`, campanha, orçamento e status, limite 10; cerca de 2 KB) de cada projeto configurado. Ajuste novo vira evento com autor em `attr:`, com a mesma chave do histórico, e o projeto vai para a frente da leitura ao vivo.
  - O pulso `syncPulse` só sobe depois de o resumo do notch ser regravado: uma vez com o autor e outra depois da releitura ao vivo. Ele é servido em `GET /api/companion/pulse`, a partir do objeto do executor (sem central e sem Supabase). A credencial do Mac é aceita nessa rota.
  - O ciclo pesado (análise, contas, sombra, histórico) continua a cada 60 s; o alarme agora acorda a cada 15 s.
  - A web consulta o pulso a cada 5 s com a aba visível: recarrega autores e dados ao vivo e mostra um aviso ("Erik pausou …"). O notch consulta a cada 8 s e relê o resumo quando o pulso muda; a partir daí os avisos de gestor e o Bunk seguem o fluxo de sempre.
  - Custo: cerca de 24 leituras leves da Malva por minuto pela ponte `malva-mcp`, sem escrita na central quando nada mudou. Ajustes feitos fora da Malva (direto na Meta) dependem de quando a própria Malva importa o histórico da Meta. Ajustes de conjunto (ABO) seguem no ciclo de 60 s.
- **Correção do diagnóstico de "rollback" e protocolo de publicação** (registro escrito às 2026-11-08 01:36:19 UTC por `date -u`). Eu tinha concluído que o build automático do GitHub publicava código antigo. **Os logs não sustentam isso.**
  - O build remoto b095e208 usou `dist/server/wrangler.json`, rodou testes, tipos e build. O build controlado 1fe1f8ac, do commit 04cfa01, passou nos 1056 testes e publicou 48301865 às 01:30:09Z (conferência do Codex).
  - Causa provável: **descompasso temporário entre o Worker e o Durable Object.** A estratégia padrão de troca de código do DO é `deferred`, com `max_delay` de 300 s, e objetos ativos seguem no código anterior até hibernar ou estourar esse prazo (Cloudflare, "Access Durable Objects storage").
  - Os horários batem: o 503 do pulso, com rota nova e DO antigo, durou cerca de 5 min depois de 390566af/53eee529. O campo `watch` apareceu cerca de 4 min depois de b6e52454. Meus deploys manuais repetidos não eram necessários e só criaram concorrência.
  - Compatibilidade durante a janela: as chaves novas do DO são aditivas (`watchConfig`, `watchTargets`, `watch-head:*`, `syncPulse`, `watchStatus`, `lastHeavyAt`). Rota nova com DO antigo devolve 503 tratado, e o notch e a web ignoram respostas diferentes de 200.
  - **Protocolo:**
    1. Um único publicador por vez.
    2. Depois de um push, aguardar o build automático (comando salvo: `npx wrangler deploy --config dist/server/wrangler.json`) e a janela de até 5 min do DO.
    3. Conferir a versão (`wrangler deployments list` ou a API), o `/health` 200 e, no status MCP `cloud-data`/`status`, a chave `watch` com `at` avançando.
    4. Não fazer deploy manual concorrente por causa de 503 transitório.
    5. Não trocar para `immediate` nem mexer em permissões.
  - Evidência real: `syncPulse` chegou à versão 3 (01:19:36Z), então o sensor já detectou ajuste real na Malva. Às 01:35:33Z, `watch.projects` estava em 6, `failed` em 0 e `paused` em false.
- **Seis melhorias pedidas pelo dono ("quero todos, vai fazendo na ordem")** (registro escrito às 2026-11-08 02:15:09 UTC por `date -u`):
  1. **Ordem direta com leitura ao vivo:** `lib/owner-order-live.mjs`. A rota do Mac lê o cache ao vivo e passa a linha para `recordOwnerChoice(opts.live)`. A proposta guarda `liveTarget`, a pré-conferência compara com ele e `approvedExecutionProposal` dispensa só a idade de 1 hora da análise para essas ordens. Testes: `tests/owner-order-live.test.mjs`.
  2. **Recibo da ordem:** `lib/owner-orders.mjs` (estado pelo diário do executor: na fila, conferindo, enviada, confirmada, conferir ou não enviada). `orders` vai no resumo do notch. O pulso sobe quando o estágio muda (`orderPulse`). No notch, a seção "Suas ordens" mostra os recibos e há aviso com reação do Bunk.
  3. **Vendas em tempo real:** `lib/sales-feed.mjs`, `app/api/webhooks/malva/route.ts` e a borda em `cloudflare-auth`. O executor guarda `salesFeed` e mescla na leitura do resumo. Falta o dono cadastrar o segredo e criar o webhook na Malva (passos em `docs/connections.md`).
  4. **Bunk mais realista:** `BunkMotion.swift` (piscar, saltos do olhar, antena com mola, achatar e esticar, arremesso, tombo), aplicado em `Bunk.swift` e `BunkDesktop.swift`.
  5. **Menos carga no Supabase:** sinal de mudanças a cada 5 s em vez de 2 s. A consulta duplicada da central virou rede de segurança de 30 s, e o pulso de ajuste pede uma checagem imediata.
  6. **Ritmo por projeto:** `alert` em `budget-pace` (orçamento acaba antes das 18h ou gasto bem abaixo do ritmo), mostrado na aba Projetos, com aviso do Bunk uma vez por dia.
- **Primeiras 24h de campanhas novas** (registro escrito às 2026-11-08 02:27:05 UTC por `date -u`). Pedido do dono: campanhas programadas de um dia para o outro e testes precisam de atenção própria nas primeiras 24h. Protocolo: `docs/first-24h-protocol.md`.
  - Causa do erro visto no notch: a regra da sombra "Pausar campanha sem entrega" só reconhecia datas de hoje e ontem. Campanhas `08/11 - ...` (programadas para amanhã) apareciam como pausáveis. Corrigido.
  - A Malva não envia `startAt` nem `deliveryStartedAt` (0 de 1.949 linhas no cache de 07/11). Identificação por data no nome + histórico de gasto: `lib/first-24h.mjs` (`newCampaignStage`: programada, 1º dia, 2º dia).
  - Teto do dono: sem venda e com 0–1 IC, não gastar R$110. Alerta a partir de 70%, a sombra registra pausa a partir de 90% (R$99), e "estourado" a partir de 100%. Com 2+ IC continua o limiar privado do projeto. A política privada pode reduzir o teto, nunca subir.
  - A regra `test-no-sale` da sombra agora vale para toda campanha nova, não só `[TESTE]`. O id foi mantido para não quebrar a revisão da sombra. O executor grava `first24h` (painel por projeto) e o resumo do notch ganhou o bloco "Primeiras 24h". O acompanhamento ganhou o sinal `first-24h`.
  - Continua só sombra: nada é executado sem proposta aprovada pelo dono.
- **Leitura Meta ao vivo para as primeiras 24h** (registro escrito às 2026-11-08 02:46:38 UTC por `date -u`). O dono cadastrou o secret `Meta_Acess_Token` no Supabase e escolheu "início programado + gasto ao vivo". A Edge Function `meta-read` (v1, verify_jwt, autenticação de serviço) faz só GET `?ids=` na Graph v23.0 (`lib/meta-live.mjs`, cópia idêntica testada). O executor faz `syncMetaLive` a cada 2 min, com até 200 campanhas candidatas (`metaLiveCandidates`), e grava `metaLive` no DO.
  - `overlayMetaLive` vale só para a lógica das primeiras 24h. O início real decide o estágio e a idade em horas. O gasto da Meta só entra quando está à frente da Malva, no mesmo dia local, convertido pela taxa da campanha. O IC fica com o maior valor e compra vista na Meta tira a campanha do teto. Leitura com mais de 10 min é ignorada.
  - O `CLAUDE.md` e o `docs/connections.md` registram o uso somente leitura. A leitura MCP `shadow` devolve `metaLive` (at, requested, read, errors).
  - Ajustes de 2026-11-08 03:29:11 UTC: a Meta descontinuou `?ids=` na v26.0 (diagnóstico real: "The ids query parameter is deprecated in v26.0+"). A leitura passou a ser por conta (`GET /act_<conta>/campaigns`, v26.0), com a ligação conta Malva → Meta em `metaAccountLinks`. Primeira leitura real às 03:26:52 UTC: 125 de 136 campanhas, campos completos (início + insights de hoje), 40 contas, 1 conta recusada (`#200`: dono da conta sem `ads_read` para esse token). O limite subiu para 80 contas e 120 pedidos por leitura (função `meta-read` v5).
  - (Corrigido abaixo: o intervalo entre a meia-noite e a primeira análise agora usa a leitura ao vivo para as primeiras 24h.)
- **Log de atividade sem duplicar o processamento da Meta** (registro escrito às 2026-11-08 03:34:15 UTC por `date -u`). O dono apontou a duplicação: cada edição de gestor aparecia de novo como "Meta alterou · ativa → em processamento", e a volta para "ativa" podia contar como ativação. `processingFlicker` (`lib/campaign-activity.mjs`) tira do log e do cartão ao vivo as transições só entre ativa e em processamento quando não há pessoa nomeada. Revisão, reprovação e restrição continuam visíveis.
- **Primeiras 24h sem ponto cego após a meia-noite** (registro escrito às 2026-11-08 03:44:58 UTC por `date -u`). Entre a virada do dia e a primeira análise do novo dia, a fonte da sombra ficava "vencida" e o painel vazio, justamente quando as programadas começam. Agora `todayRows` usa a leitura ao vivo do novo dia (`kind:'live-only'`, `aligned:false`): só a regra das primeiras 24h roda, sem janelas fechadas desalinhadas, apoiada no início real da Meta. As outras regras esperam a análise. Leitura Meta às 03:41:36 UTC: 180 de 180 campanhas lidas em 49 contas, 3 contas puladas, 20 campanhas sem ligação de conta.
- **Painel de contas com o token do Supabase** (registro escrito às 2026-11-08 03:51:46 UTC por `date -u`). O painel mostrava "token de leitura da Meta ainda não cadastrado" porque o secret `META_ACCOUNTS_TOKEN` do Worker nunca existiu. Sem ele, o executor agora lê `/me/adaccounts` pela função `meta-read` (v6, `{"action":"accounts"}`, cópia idêntica de `account-limits.mjs`) com o secret `Meta_Acess_Token` do dono. A versão do painel subiu para 3, para ele ser relido no próximo ciclo.
- **Webhook de vendas endurecido antes de ligar** (registro escrito às 2026-11-08 04:10:06 UTC por `date -u`). Revisão do Codex reproduziu: pedido pendente/unpaid aceito como pago, valor solto aceito, venda sem projeto aparecendo em todos os projetos e dedupe sem projeto. Correção: só entra venda com status/assunto explícito de pago e nenhum status negativo (pending, unpaid, aguardando, recusado, expirado, cancelado, reembolso, estorno, chargeback, processing); `order.created` ou valor solto não contam. O endereço agora é `/api/webhooks/malva/<segredo>/<id do projeto Malva>` (sem projeto: 400); o projeto do endereço é a autoridade, pedido que cita outro projeto ou mais de um é recusado (422); o executor só aceita projeto em `watchConfig` (projetos Meta configurados) e pedido com id; hash e dedupe são por projeto + pedido; `salesView` nunca mostra venda sem projeto numa visão de projeto. Testes de regressão com os cinco casos. Sem segredo gerado, webhook criado ou venda em produção. Publicação única aguardando revisão do Codex. Pendente: conferir o formato real do evento da Malva na primeira entrega. Segunda revisão do Codex: "order.paid" com status rejected, "order.not_approved" e projeto divergente entre envelope e `data` ainda passavam; agora negativos explícitos (rejected, reprovado, erro, bloqueado, parcial…) e negações antes de palavra positiva vencem em qualquer campo de status, e os projetos do envelope, de `data` e do pedido precisam coincidir (senão: ambíguo, recusado).
  - 2026-11-08 04:15:45 UTC: diagnóstico real da Meta para o painel: "Tried accessing nonexisting field (adtrust_dsl)". O campo do limite diário da conta saiu da Graph v26. Agora `readMetaAccounts` retira campos que a Meta declara inexistentes e mantém status, moeda e gasto de hoje. O limite diário fica N/D, com o motivo em `metaDiagnostic` (função `meta-read` v8, painel v5). Pendência: achar a fonte atual do limite diário na Meta, sem chutar nome de campo.
- **20 baterias de testes com correção de gaps** (registro escrito às 2026-11-08 04:50:24 UTC por `date -u`). Pedido do dono: "Faça 20 baterias de testes, cada uma mais profunda, resolvendo gaps". Suíte de 1090 para 1132 testes; typecheck e build ok.
  - **Correções:** (1) `owner-orders`: ordem parada antes do envio com reserva vencida deixa de mostrar "Conferindo" por 24h; vira "Expirou sem execução" (autorização vencida) ou `failed` "Não enviada · tentativas esgotadas" (3 tentativas), sem novo estágio para o notch. (2) `owner-applied`: "Divergente" só quando o `lastSyncAt` da origem é posterior ao relato; antes disso "A conferir" (a Malva podia ainda não ter sincronizado). (3) `first-24h`: texto diz "venda N/D" quando vendas são desconhecidas (antes afirmava "0 venda") e "sem gasto ainda" sem teto nulo. (4) `budget-pace`: após a meia-noite a leitura "hoje" do dia anterior vira N/D (antes gerava ritmo e alerta falsos). (5) `sales-feed`: id de pedido numérico aceito, moeda só ISO, valor texto ambíguo ("1.297") vira N/D, data de pagamento futura não é confiada. (6) `owner-device`: base64 inválido sai com código fixo. (7) `snapshot-schema`: importação recusa gasto, receita bruta, pedidos, IC, impressões, cliques, vídeo e orçamento negativos e câmbio ≤ 0 (conferido antes contra as 1.968 linhas reais do cache: nenhuma quebra). (8) `change-watch`: ajustes ordenados pelo horário, sem depender da ordem da Malva (evita avisos repetidos).
  - **Travas novas:** cópias das Edge Functions idênticas ao `lib/`; leitura Meta só GET; só `tracking_set_ad_budget`/`tracking_set_ad_status` como escrita; fuzz de 250 rodadas com dois executores (nunca mais de um envio por proposta).
  - **Achado em produção, aguardando decisão do dono:** `historyLearning.changes` atingiu o teto de 10.000 (9.084 não financeiras, 916 de orçamento/status, de 19/10 a 07/11 14:45 UTC). 46 campanhas falham com `SOURCE_HISTORY_CAPACITY` (última 01:47 UTC de 08/11): o aprendizado de histórico parou. O registro central comprimido está em 1.722.777 de 1.750.000 bytes (98,4%) e 13,47 MB de 16 MB descomprimidos; ao passar, toda gravação da central falha com `STORAGE_LIMIT`. A solução (arquivar fora da central ou podar mudanças não financeiras antigas) mexe em histórico e não foi aplicada.
- **50 baterias de aprimoramento do notch** (registro escrito às 2026-11-08 05:27:14 UTC por `date -u`). Pedido do dono: "50 baterias de aprimoramento do notch: visual, UIX, funcional, otimizações". Commits 321e32a, 3d76993 e o desta entrada; app reinstalado; `--self-test` ok; `npm test` 1132/1132.
  - **Visual:** variação de cada KPI ao lado do período ("ontem 1,31x ↑8%"), cards do topo com mesma altura, ritmo em duas linhas sem corte, contas com "R$ 1.780,00"/"US$", estilo próprio de campo de texto e botões da ilha no Sistema, respiro no texto à direita do notch fechado, sino no contador de atenção, texto das pílulas neutras com contraste AA (era 4,3:1).
  - **UX:** plurais em português (sem "(s)"), espiada com aprovações e perdas antes do ROAS, ritmo diz "orçados" (não repete "gasto" com outro número), textos atualizados sobre a ordem direta com Touch ID (detalhe, preview e aviso do servidor em `companion-summary`), teclas ← → entre abas e dica do atalho, percentual aceita "20%" e explica cada recusa, troca de projeto fecha o detalhe anterior, mostra o nome escolhido na hora e esmaece os números antigos.
  - **Funcional:** resposta atrasada de outro projeto não sobrescreve mais a atual; resumo decodificado por seção (fuzz de 287 campos nulos/ausentes: de 156 para 6 falhas, todas do núcleo; ferramentas `--decode-summary` e `--dump-preview`); erro de formato, de tempo e de conexão com mensagens distintas; leitura imediata quando a rede volta; aviso de ritmo uma vez por dia do Bunker (não UTC); memória de avisos limitada; recibo de ordem não chuta "Aumentar"; sem Touch ID duplo em clique duplo; dígitos digitados no campo de link não trocam de aba; rótulos de VoiceOver nos botões de ícone.
  - **Otimizações:** medido antes 8,2% de CPU em repouso e 71 MB; depois 0,05% (pico 0,7%) e 59 MB. Causas: Bunk da área de trabalho a 30 quadros/s parado (agora 10 em repouso) e olhar regravado a cada quadro; `track()` a cada movimento do mouse em qualquer lugar (agora só perto da ilha); Keychain consultado a cada pulso de 8 s (agora em memória, relido após 401); formatadores recriados a cada valor; decodificação na thread principal; rodízio calculado 3 vezes por desenho; pulso pausado offline; tolerância nos temporizadores; barra de menus só regravada quando muda.
  - **Não verificado ao vivo:** a medição de CPU foi com o app em repouso logo após reiniciar; o caso "Bunk passeando na área de trabalho" e o filtro de mouse dependem do uso real.
- **Proposta para o histórico lotado e a central no limite** (registro escrito às 2026-11-08 05:32:49 UTC por `date -u`). Aguardando aprovação do dono; nada implementado.
  - **Medição (retrato de 04:50 UTC, central rev. 7026, sem gravação desde 01:57 UTC):** central comprimida em 1,28 MB de ~1,31 MB úteis (limite de 1,75 MB em base64). Sobram ~30 KB, o equivalente a cerca de 10 resultados medidos (~2,7 KB comprimidos cada; foram 53 em 07/11). Ao passar o limite, toda gravação da central é recusada com `STORAGE_LIMIT` (análises, escolhas, ordens e aprovações), sem perda de dados. Peso comprimido: mudanças do histórico 370 KB, resultados medidos 267 KB (`request` = pedido preservado de ~7 KB, 42%), eventos 129 KB, importações 119 KB (1.015 das 1.043 observações repetem as dos eventos), resto 398 KB.
  - **Mudanças do histórico:** 10.000 = teto, todas de 19/10 a 07/11, ritmo crescente (2.630 só em 07/11). 9.084 são não financeiras (4.911 de status, 1.235 criações, 912 de lance, 721 de criativo, 700 de público, 563 de entrega); 1.647 são citadas por resultados medidos. Leitores: `decision-history-outcomes` (marca "outra mudança na janela") e `external-adjustment-sequence` (exibição; mudança ausente vira "indisponível").
  - **Proposta (mover, nunca apagar):** (1) tirar da central e guardar em registros próprios de `bunker_records`, como já é feito com as leituras: mudanças por projeto, partes pesadas dos resultados (`request`, `before`, `after`) e recibos de importação com mais de 7 dias; a central fica com resumo e digest. Estimativa: central de ~1,28 MB para ~0,6 MB comprimidos. (2) Trocar o teto por quantidade por uma regra de tempo e referência: financeiras sempre; não financeiras por 35 dias e enquanto citadas por resultado; as mais antigas em registros mensais frios. (3) Alarme de armazenamento a 85% no painel e no notch, com teste.
  - **Recusado:** só subir o teto (estoura a central em horas) e podar o histórico antigo (viola a integridade e nem libera nada, já que tudo tem menos de 20 dias). A mudança mexe na camada de persistência e pede revisão do Codex antes da publicação única.
- **Histórico fora da central — implementado** (registro escrito às 2026-11-08 09:44:29 UTC por `date -u`). Pedido do dono: "Sim, implementar". Às 09:43 UTC a central estava em 1.747.160 de 1.750.000 bytes (rev. 7120).
  - `lib/history-storage.mjs`: `historyLearning.changes` em grupos por projeto, dia UTC e classe, e `request`/`before`/`after` de cada resultado medido em registros `history-changes:<sha256>` / `history-outcome:<sha256>` (gzip, chave = hash do conteúdo descomprimido). Gravados na mesma transação da central; lidos numa busca só; registro ausente ou alterado falha fechado (`STORAGE_INTEGRITY`). Grupos não financeiros com mais de 35 dias e sem citação ficam frios (guardados, listados em `changesArchive`, não carregados). Teto quente 10.000 → 30.000. Medição com janela em grupo frio da mesma campanha ganha limitação.
  - Validação com o estado real (rev. 7026): ida e volta idêntica byte a byte; central 57,5% do limite; 189 registros (903 KB); 1º envio 1,95 MB; nada reenviado sem mudança.
  - Alarme a 85% (central ou teto quente) no painel web, no resumo do notch (`storage`, via executor) e no app do Mac.
  - Revisão independente (subagente; o Codex não estava disponível nesta sessão): nada impeditivo. Corrigidos: `changes` deixado por Worker antigo é unido (não escondido); limitação de arquivo casa campanha e dia UTC. Aceitos: releitura de período antigo pode duplicar entradas frias (duplicação, não perda); leitura cresce ~6 registros/dia + 1 por resultado (acompanhar latência). **Pendente:** revisão do Codex; carregar a evidência dos resultados sob demanda antes de chegar perto de 1.000 resultados.
- **Saldo por período ao lado do prejuízo de hoje** (registro escrito às 2026-11-08 10:55:23 UTC por `date -u`). Pedido do dono: uma campanha negativa hoje pode ser positiva somando os períodos; o gestor precisa ver as duas coisas. `campaignBalance` em `lib/daily-brief.mjs` dá o saldo de hoje, ontem, 3d e 7d (resultado com custos, senão receita − mídia) e `7d + hoje`/`3d + hoje` (7d e 3d terminam ontem, então os dias não se repetem; bases diferentes não somam → N/D). `verdict`: `recovers` (hoje negativo, 7d + hoje positivo) ou `negative`. Cada item da fila (`actionQueue`) leva `balance`; o resumo do notch repassa. Notch: a linha da fila mantém o prejuízo de hoje em vermelho e ganha a faixa "hoje negativo · histórico positivo · ontem · 3d · 7d · 7d+hoje"; o detalhe mostra o saldo em cada período e um cartão "7 dias + hoje". Web: mesma faixa em "O que fazer agora". Teste novo só com hoje não mostra faixa. Nenhuma regra de decisão ou campanha alterada.
- **Falhas de JSON da IA (gpt-oss) reduzidas** (registro escrito às 2026-11-08 11:57:12 UTC por `date -u`). Diagnóstico (só leitura): `CLOUD_AI_INVALID` em ~10% das etapas desde a troca para gpt-oss-120b; 94,5% recuperavam na tentativa seguinte, mas cada falha perdia o pulso e atrasava os outros projetos; 3 etapas desistiram. A Cloudflare não garante o esquema JSON nesse modelo; a falha é JSON malformado com término normal, e o truncamento em 6400 parece geração em loop (1,6× a maior saída bem-sucedida), não falta de teto. Correção: `lib/cloud-model-json.mjs` usa o conteúdo como está quando já é JSON e, senão, só remove invólucros sem perda (bordas, cerca de código, cabeçalho final do gpt-oss uma única vez após mensagens completas de `analysis`); nunca conserta, extrai de prosa ou escolhe entre dois valores. Recusa guarda `shape`, faixa de tamanho, presença de raciocínio e `reasoning_tokens` (nunca conteúdo) e a tentativa seguinte recebe o `shape`. Falha de formato já registrada como tentativa é repetida no mesmo pulso (teto de 4 unidades e 3 tentativas mantidos). Pergunta do dono: 3 tentativas por rodada só para falhas de formato/validação (`lib/owner-question-limit.mjs`), renovadas por nova rodada; escritório mostra "Sem resposta". Revisão independente em duas rodadas: achados confirmados (escolha da última resposta final, pergunta estacionada por queda do provedor, canal parecido com "final", selo sem cor) corrigidos; 3M+ entradas comparadas com o leitor antigo sem regressão. Pendente: medir a queda das falhas e ler os `shape` reais nos próximos dias; `cloudAttemptFailures` não é podado (estado central sob pressão de tamanho).
- **Respostas cortadas por tamanho (gpt-oss)** (registro escrito às 2026-11-08 12:20:47 UTC por `date -u`). Antes da correção, ~4 de 16 etapas por meia hora terminavam em `output_truncated` exatamente em 6400 tokens, enquanto nenhuma etapa bem-sucedida passou de 4049: sinal de laço, não de falta de teto. Pesquisa: OpenAI recomenda temperatura 1/top_p 1 para o gpt-oss; temperatura baixa favorece laços (relato idêntico no Workers AI); penalidades de repetição foram descartadas (prejudicam JSON com chaves e IDs repetidos). Mudança: o truncamento agora registra `contentPresent`, faixa de tamanho, `repetition`/`repetitionKind` (detector KMP linear nos últimos 8192 caracteres, sem guardar texto), `maxTokens` e `temperature` enviados; a tentativa seguinte da mesma etapa, só quando a imediatamente anterior foi truncamento (`prior.attempt===claim.attempt-1`), usa temperatura 1/top_p 1 com o mesmo teto; `generationProfile` registra temperatura e ajuste. Primeiras tentativas seguem em 0,1. `docs/agent-learning-cycle.md` atualizado. Pendente: ler `repetition` de ~20 truncamentos e decidir se a temperatura base sobe (0,6→1) com medição de JSON inválido e consistência.
- **Pausar, aumentar e reduzir direto do notch via Malva** (registro escrito às 2026-11-08 12:25:05 UTC por `date -u`). Pedido do dono: "Eu quero poder pausar, aumentar, reduzir direto do notch, ainda não estou conseguindo. E preciso que tudo seja feito via mcp malva".
  - **Diagnóstico (central rev. 7406, só leitura):** nenhuma proposta com `ownerOrder` existia. As tentativas do dono pelo notch (pausas às 00:59 e 01:45 UTC) entraram como "Pedir à equipe" e ficaram em "Pendente de revisão". Travas do caminho antigo: revisão da central igual à da abertura (o executor grava a cada poucos segundos → 409 quase sempre), rodada conjunta válida, card da análise, decisão anterior ("Manter") e contexto da rodada revalidado na execução.
  - **Correção:** operação nova `ownerDirectOrder` (detalhes em `docs/connections.md`): Touch ID → servidor compara o valor exato que o dono viu com a leitura ao vivo da Malva → proposta `Aprovada` sem rodada (15 min) → executor Cloudflare relê a Malva, envia uma vez e confirma. Notch: "Executar agora" usa o bloco `directOrder` dos cards, funciona para campanha fora da análise (`--render-notch` 15) e mantém "Pedir à equipe"/"Já fiz" quando há card.
  - **Testes:** `tests/owner-direct-order.test.mjs` (ciclo completo, valores mudados, cercas, repetição, expiração, pausa, poda), suíte 1164/1164, typecheck, build, self-test nativo; também numa cópia limpa do HEAD só com estes arquivos (havia mudanças de outra sessão no checkout, não incluídas).
  - **Não verificado ao vivo:** nenhuma ordem real foi enviada por mim; o primeiro uso é do dono com a digital.
- **100 baterias de assertividade das sugestões de ação** (registro escrito às 2026-11-08 12:56:28 UTC por `date -u`). Pedido do dono: "100 baterias de testes para melhoria de assertividade de sugestões de tomada de ação". Sem dados operacionais no repositório; séries e relatórios ficaram no scratchpad da sessão.
  - **Banco de prova real** (`scripts/suggestion-backtest.mjs`, testado): 60 campanhas que somam 85% do gasto de 7 dias (John, Leandro, Nico, Murilo), série diária de 14 dias pela Malva (`tracking_ad_detail`, só leitura). 232 dias (01–06/11), cada sugestão comparada com o resultado real do dia seguinte. A folha diária não traz vendas front nem IC: regras que dependem disso rodaram em modo aproximado (front ≈ pedidos), marcado como tal.
  - **Resultados** (precisão = o dia seguinte confirmou a sugestão): base 60% dos dias seguidos de lucro. "Hoje negativo" previu dia seguinte negativo em 34% (IC 25–45%), estável por projeto e nas duas metades. Dia ruim isolado: 29%. "Reduzir em dia ruim" da sombra: 36–43%, com cerca de metade cortando vencedores do dia seguinte. Dia forte (ROI ≥ 3 e ≥ 3 pedidos): 76% (IC 53–90%), 86% em dois dias. Aumento com histórico de 3d ≥ 1,3: 69%. Gasto depois de dia ruim subiu (mediana 1,8×), então a melhora não veio de corte do gestor. Vieses declarados: amostra das maiores campanhas (sobrevivência) e n pequeno. "Dois dias ruins seguidos" não se sustentou fora da amostra.
  - **Auditoria dos motores** (fluxo de 101 agentes, 3 céticos por achado): 19 defeitos confirmados, 18 corrigidos (7 grupos, revisão adversarial, ajustes dos revisores aplicados). Entre eles: "Teste protegido" eterno sem data de início (Malva não envia), teto das primeiras 24h ignorando o gasto antes da meia-noite, alerta de perda que nunca disparava sem vendas, sombra repetindo ±% sobre a mesma evidência e apagando o que o gestor fez, rejeição dos pares ainda exibida como sugestão da equipe, "Já fiz" conferido reabrindo a campanha, item de IA inválido derrubando a etapa, fila do notch ignorando pausas ao vivo, "Amostra recente" para amostras sobrepostas. Não aplicado: perda de 3 dias com hoje positivo (veredito contraditório e backtest contra).
  - **Placar da sombra**: `shadowGrades` dá nota a cada decisão pelo dia seguinte real (acertou, errou, parou, N/D; "cortou vencedor" com ROI ≥ 1,2). O placar acumulado dos 7 dias vai no resumo (`shadow.scorecard`) e no notch. É a base da revisão da sombra exigida em `docs/autonomy-policy.md`.
  - **Propostas ao dono aplicadas em 08/11/2026 ("Aplicar agora")**, constantes em `shadowRulePolicy`: (1) "reduzir em dia ruim" fica só como sugestão até o placar da própria regra chegar a ≥ 60% com ≥ 20 decisões avaliadas (`ruleAccuracy` sobre a sombra guardada, passada pelo executor); (2) "aumentar por vendas" exige histórico de 3d com ROI ≥ 1,3; (3) dia forte (ROI do dia ≥ 3) leva +50%, os demais +30%. Continua tudo em sombra; teste `tests/shadow-rule-policy.test.mjs`.
- **Motivo exato das falhas da revisão de memória (parte 1)** (registro escrito às 2026-11-08 12:56:39 UTC por `date -u`). Leitura após a correção de truncamento: 14 etapas seguidas sem nenhuma falha desde ~12:34 UTC (antes ~4 cortes a cada 16); sem dados de corte, a temperatura base não foi alterada. `CLOUD_MEMORY_REVIEW_EVIDENCE` vinha de 9 causas com o mesmo código; agora cada uma tem rótulo fixo e posição (`lib/memory-review-failure.mjs`: references_format, reference_shape, reference_not_in_packet, not_in_reflection, ambiguous_reflection, duplicate_reference, index_invalid, numeric_evidence_required, inconclusive_required), lançado em `cloud-evidence-references.mjs` e `agent-memory-review.mjs`, mostrado no histórico do executor e no contexto de revisão. Nenhuma checagem foi relaxada. Parte 2 pendente, combinada com a sessão "20 baterias de testes" que está editando `cloud-engine.mjs`/`cloud-analysis.mjs`: guardar o rótulo em `cloudAttemptFailures` e repassá-lo no `validationFeedback` com uma frase no prompt.

## Faixa rápida do executor: ordem e status do notch (registro escrito às 2026-11-08 13:06:42 UTC por `date -u`)

- Pedido do dono: "quando eu executo a ação no notch acho que demora muito" e "demora pra reconhecer a mudança de status".
- Medido nos registros `live:*`: releituras em pares a cada ~3,5–4,5 min, ou seja, ~12 min por projeto. O watch de 15 s ficava bloqueado durante o pulso pesado.
- Mudanças:
  - `worker/cloud-executor.ts`: `fastLane`, ação `wake`, `syncLive(first,only)`, `recordUnit`/`publishOrders`/`bumpLive`.
  - `lib/change-watch.mjs`: `fastUnits`, `liveStaleMs`, `fastLaneKinds`.
  - `lib/cloud-engine.mjs`: `cloudNext`/`step` com `{only}`.
  - `app/api/companion/owner/route.ts`: chama `wake` depois do commit.
  - `Store.swift`: pulso a cada 2 s por 2 min após uma ordem.
- Regras financeiras inalteradas. Detalhes em `docs/cloud-executor.md` › Faixa rápida.
- Teste: `tests/executor-fast-lane.test.mjs`.
- Pendente: medir em produção o tempo da aprovação até o recibo confirmado depois do deploy. O app do Mac precisa ser reinstalado (`mac/build.sh`).
- **Motivo exato das falhas da revisão de memória (parte 2)** (registro escrito às 2026-11-08 13:07:57 UTC por `date -u`). `failCloudOpinion` guarda `memoryReviewFailure` sanitizado só para `CLOUD_MEMORY_REVIEW_EVIDENCE`; a tentativa seguinte da mesma etapa recebe o rótulo no `validationFeedback` e o prompt explica cada rótulo ("Corrigir não relaxa nenhuma checagem"). Revisão independente apontou rótulo errado para referência com campo a mais/sem métrica (agora `reference_shape`), corrigido. Coordenado com as sessões "20 baterias de testes" (f72eb8a) e "Ajuste de campanhas via notch" (f12cf48, faixa rápida), publicados juntos.

## Faixa rápida em paralelo ao pulso pesado (registro escrito às 2026-11-08 13:29:02 UTC por `date -u`)

- Medição depois do f12cf48: as releituras ao vivo caíram de ~12 min para no máximo ~7 min, porque uma etapa longa do modelo ainda segurava a faixa rápida.
- O dono aprovou ("Sim, fazer") rodar a faixa rápida num temporizador de 5 s durante o pulso pesado.
- Proteções:
  - execução única (`runLane`);
  - gravações da central serializadas no objeto (`writeChain`), cada uma relendo antes do CAS;
  - `liveReading` impede duas leituras ao vivo do mesmo projeto;
  - o trabalho de ordem (verify/followUp/execution) é só da faixa rápida: o pesado usa `step({skip})`, com varredura a cada 60 s.
- Testes: `tests/executor-fast-lane.test.mjs` cobre a ordem servida durante uma unidade lenta e a não sobreposição de gravações.
- Pendente: medir em produção que nenhum projeto passa de ~3–4 min.
- **Laço de espaços aceito como resposta inteira** (registro escrito às 2026-11-08 13:37:51 UTC por `date -u`). Diagnóstico real: truncamento com `repetition:whitespace` e conteúdo de 8–16 KB (resposta pronta seguida de espaços até o teto). Decisão do dono ("Sim, aceitar"): com finish `length`, conteúdo que é exatamente um objeto JSON completo mais espaços nas bordas é aceito (`completeBeforeWhitespace` em `lib/cloud-model-policy.mjs`), passa por todas as validações e o `generationProfile` marca `recovered: trailing_whitespace`. JSON incompleto, texto, marcadores, cercas ou dois objetos continuam recusados. Revisão independente: nenhum defeito confirmado. Nota: a frase de `docs/cloud-executor.md` entrou junto no commit e4b330d de outra sessão.
- Resultado em produção (08/11, versões 386f730b → 091434b): com e4b330d, projetos com edições frequentes eram relidos 2–3 vezes em 8 min e dois projetos quietos ficavam ~9 min. O 091434b sempre inclui o projeto mais antigo. Nas medições de 14:01 e 14:06 UTC, nenhum dos 6 projetos passava de 3 min desde a última leitura. Entre amostras, um intervalo maior para um projeto não pode ser descartado. Executor enabled, lastError null, sem falhas desde 13:35 (conferido pela sessão onboarding). Falta a primeira ordem real do dono pelo notch para medir aprovação → confirmado.
- **Sons de aumento, redução e pausa no Mac** (registro escrito às 2026-11-08 14:22:50 UTC por `date -u`). Pedido do dono: som no computador para cada aumento, redução e pausa, com pelo menos 5 opções por status nas configurações e as melhores referências trazidas ao projeto.
  - App do notch: `AdjustSound.swift` (regras), `SoundCatalog.swift` (7 sons + "Nenhum" por status), `SoundSynth.swift` (tons gerados em código e sons do macOS cortados em 0,7 s; nenhum arquivo de áudio no repositório), `SoundSettingsView.swift` (janela "Configurações de som", aberta pelo menu). O `Store.deliver` toca o som e silencia a notificação do mesmo ajuste.
  - A revisão adversarial (3 lentes, 19 agentes) confirmou e eu corrigi: transição repetida sem som, ordem confirmada tocando duas vezes, som perdido em reunião, sobreposição com outra notificação e chave de som do sistema ignorada. Os ajustes fora dos 12 mais recentes agora são detectados pelo contador de 24h.
  - Referências e regras: `docs/notch-sounds.md`. Limites conhecidos: o Foco do macOS não cala o som (use "Silenciar avisos"), ajustes de conjunto (ABO) não entram no feed e o som segue o projeto escolhido no notch.
- **Campanha pausada pelo notch continuava listada** (registro escrito às 2026-11-08 14:48:40 UTC por `date -u`). Relato do dono: depois de pausar pelo notch, a campanha não sumia. Diagnóstico com investigação paralela, verificação adversarial e dados de produção: as 3 pausas de hoje eram testes de 1º dia, na lista "Primeiras 24h". O quadro dessa lista só era recalculado no pulso pesado, e a faixa rápida reaproveitava o quadro antigo. A fila "O que fazer agora" já tirava a campanha.
  - Correção da raiz no worker: com a sessão "Ajuste de campanhas via notch", que também corrigiu em e558c6e o liveItems antigo sobrescrevendo a releitura da faixa rápida.
  - Rede de segurança nesta sessão: `first24hWatch` tira na hora a campanha com pausa mais nova que o corte (execução confirmada do Bunker, histórico Malva, mudança observada ou leitura ao vivo), e nunca mostra effectiveStatus pausado. Em `pausedAfterAnalysis`, a leitura ao vivo é datada pela sincronização da origem e PAUSED em qualquer campo vale como pausa. `actionQueue` exige status e effectiveStatus ACTIVE.
  - No Mac: o detalhe da campanha acompanha cada leitura e avisa quando ela sai da fila, e a tela de ajuste relê quando a ordem é confirmada. Teste: `tests/notch-paused-leaves.test.mjs` (falha no código antigo, passa no novo).
- **Sombra marca a pausa feita pelo dono** (registro escrito às 2026-11-08 15:08:09 UTC por `date -u`). Pedido do dono ("Yes, mark them"): na "Sombra do Bunk · hoje", a pausa que ele mandou pelo notch aparecia como "executaria". Agora `shadowOutcomes` grava `owner` quando a mesma ação passou pelo Bunker (ordem do notch ou proposta aprovada), separado de `manager`; "antes do gestor" e os contadores não mudam. O notch mostra "pausada por você" (ou "ajustada por você") em verde. Aparece no próximo pulso pesado (1–3 min). Teste em `tests/notch-paused-leaves.test.mjs`.
- **Sombra mostra as mais recentes primeiro** (registro escrito às 2026-11-08 17:04:51 UTC por `date -u`). Pedido do dono ("Yes, fix it"): a lista "Sombra do Bunk · hoje" vinha na ordem de gravação, e uma campanha recém-pausada podia ficar fora das 5 linhas. `shadowSummary.recent` agora ordena pelo evento mais novo de cada decisão (criada, ação do gestor ou ação do dono), mais novo primeiro, e mantém 12. Contadores e placar não mudam; o Mac não precisou de mudança. Teste em `tests/notch-paused-leaves.test.mjs`.

## Limite diário sincronizado e busca de contas (registro escrito às 2026-11-08 17:19:59 UTC por `date -u`)

- **Pedido do dono:** o limite de gastos diário definido pela Meta sempre sincronizado em todas as contas; buscar contas por nome ou ID na aba Contas.
- **Fonte:** a Graph v26 recusa `adtrust_dsl`, que também saiu da referência atual da conta de anúncio; o Malva tem `dailyLimit` vazio (conferido no projeto Ronald) e o conector oficial da Meta não tem campo de limite da conta. Sem chutar nome novo: quando a versão atual recusa o campo, `readMetaAccounts` lê só `account_id,adtrust_dsl` nas versões anteriores ainda servidas (`limitFallback`: v25.0, v24.0, v23.0, v22.0) e junta pelo ID. `limitVersion` e `limitTried` vão da função `meta-read` ao `metaDiagnostic` do painel (versão 6), que agora aparece na aba web.
- **Busca:** campo "Buscar conta por nome ou ID" na aba web e no notch (`accountMatches` em `lib/account-limits.mjs` e `Format.accountMatches`); ignora acento e maiúscula, aceita ID com ou sem `act_`; com texto digitado, a busca ignora o filtro "Só ativas". A lista guardada continua sendo só ativas e quedas dos últimos 7 dias.
- **Resultado (2026-11-08 17:32:51 UTC, painel v6 montado às 17:31:19Z, função `meta-read` v9, Worker publicado às 17:21:54Z):** a Meta recusou `adtrust_dsl` em v25.0, v24.0, v23.0 e v22.0 (todas `META_100`). O limite diário definido pela Meta não está mais disponível pela API pública em nenhuma versão; segue N/D com o motivo na tela. Busca por nome/ID publicada (web no Worker; notch instalado). O Site `chatgpt.site` continua em versão antiga, sem a aba de contas.
- **Decisão do dono (2026-11-09):** "Pedir ao Malva". Antes: fonte alternativa para o limite: pedir ao Malva que preencha `dailyLimit` (o campo existe e está vazio), ler a página de faturamento da Meta com o login do dono (frágil) ou registrar o valor à mão no painel.
- **Malva como fonte (2026-11-09 05:36:19 UTC por `date -u`):** o painel (versão 7) usa `meta.dailyLimit` do Malva quando a Meta não informa o limite; a Meta continua tendo prioridade. Cada linha leva `limitSource` (`Meta`, `Malva` ou `N/D`), os contadores levam `limitFromMalva`, e a aba web mostra "via Malva". Sem gasto da Meta na moeda da conta, o uso % fica N/D. Conferido no Ronald em 09/11: as 37 contas têm `dailyLimit` vazio, inclusive as 11 ativas com `detailsReadAt` de 08–09/11, sem `detailsError`.
- **Pendente (dono):** enviar ao suporte do Malva o pedido para preencher `dailyLimit` (o texto foi entregue no chat). Depois, conferir no painel `counts.limitFromMalva > 0`.

## Sombra cega no 2º dia de teste que vendeu ontem (registro escrito às 2026-11-08 17:33:15 UTC por `date -u`)

- **Relato do dono:** um gestor pausou campanhas pela Malva sem registro prévio da sombra; "o gestor nunca pode fazer primeiro".
- **Leitura (Malva e sombra `cloud-data`, dados fora do repositório):** das 7 pausas do gestor naquele minuto, só 1 estava na sombra, e por acaso (antes da análise do dia a janela de ontem não estava lida). As outras 6 não tinham registro: 5 testes no 2º dia que venderam no 1º dia e gastaram hoje sem venda (de 0 a 14 IC), e 1 campanha [AVATAR] com venda hoje e ROI perto de 1, que nenhuma regra cobre.
- **Causa:** no 2º dia a regra `test-no-sale` somava ontem + hoje; a venda de ontem deixava a campanha "com venda" o dia todo. A regra de dia ruim exige histórico de 3 dias e não avalia campanhas novas.
- **Correção:** `launchGuard` em `lib/autonomy-shadow.mjs` (sombra e quadro "Primeiras 24h"): quando a venda é só de antes de hoje e hoje há gasto sem venda, o gasto de hoje é conferido sozinho contra o mesmo teto (R$110 com 0–1 IC; limiar privado do projeto com 2+ IC; sem limiar, registra bloqueado a partir de R$110). Motivo exibido: "vendeu ontem, hoje sem venda". Continua só sombra: nada executa.
- **Limites:** o limiar de 2+ IC depende de `pauseTestMinSpend` na política privada de cada projeto (não lido aqui); sem ele a decisão aparece bloqueada. Campanha com venda hoje e ROI baixo segue fora das regras; decidir com o dono se vira regra.

## Avisos do Bunk no iPhone (registro escrito às 2026-11-08 17:49:30 UTC por `date -u`)

- **Pedido do dono:** "uma forma de o Bunk conseguir me avisar no meu iphone". Escolhas dele: Pushover; perda, proposta aguardando, ordem confirmada/falhou e ritmo do orçamento.
- **Mudança:** `lib/phone-alerts.mjs` (novo) e `storeCompanion` em `worker/cloud-executor.ts` enviam esses avisos depois de gravar o resumo do notch, uma execução por vez, com memória `phoneAlerts` no DO. Status em `phone` no `status` do executor. Detalhes e passo a passo em `docs/connections.md` ("Avisos no iPhone pelo Pushover").
- **Pendente (dono):** instalar o Pushover, criar a aplicação e cadastrar `PUSHOVER_TOKEN` e `PUSHOVER_USER` pelo wrangler. Sem eles o envio fica desligado. Depois: conferir `phone.primed:true` e o primeiro aviso real no iPhone.

## Quatro regras novas na sombra, a partir dos gestores (registro escrito às 2026-11-08 18:37:05 UTC por `date -u`)

- **Aprovação do dono:** "Aplicar as 4", depois de estudo somente leitura de pausas de campanhas novas com venda e das edições de orçamento de um gestor (dados fora do repositório; resumo em `docs/autonomy-policy.md`).
- **O que mudou** (`lib/autonomy-shadow.mjs`, `shadowRulePolicy` v2): `new-sale-loss` (campanha nova com venda, R$300+ e ROI < 0,8 pausaria; 0,8–1,0 só alerta); `bad-day-reduce` cobre campanhas de 1 a 3 dias com ontem ≥ 1,2, gatilho ROI < 0,9, −30% se aumentada hoje; `night-increase` (00:00–00:30, 1–4 dias, ontem ≥ 1 front e ROI ≥ 1,3); `morning-increase` sem exigir 3 dias em campanha nova (2+ front, ROI ≥ 2, +30%). Regras de orçamento com portão de placar (`scoreGatedRules`; o worker passa o placar de todas). Mac lê as regras de forma genérica, sem mudança.
- **Testes:** `tests/shadow-four-rules.test.mjs`. Nada executa: fase sombra.
- **Pendente:** ver as regras novas aparecerem em produção (a de virada do dia só à 00:00–00:30) e revisar o placar com o dono.
- **Publicação:** a versão automática `bdf7da57` (18:38 UTC) não serviu o código novo (o resumo da sombra não tinha as regras novas). Publiquei manualmente deste checkout (`287d694`) com o comando do runbook: versão `52afd7a8`. Às 18:48 UTC a sombra já avaliava as regras novas (10 decisões `new-sale-loss`, 8 marcadas "executaria", 2 só alerta). Investigar por que a publicação automática não pegou o commit.

## 24 novas baterias de teste com correção (registro escrito às 2026-11-09 06:50:09 UTC por `date -u`)

- **Pedido do dono:** "Faça novas baterias". Escopo: o que mudou desde `0e760c9` (sombra e as 4 regras, launchGuard, primeiras 24h, fila do notch, avisos do iPhone, avisos de mudança, Mac, segurança, coerência docs/código). 8 frentes × 3 baterias (contrato, interação e virada do dia, fuzz com semente fixa), provas só no scratchpad, sem produção. 50 achados, 48 confirmados por 3 céticos (reprodução, intenção, impacto).
- **Correções** (7 grupos sem arquivo em comum, cada um com 2 revisores; depois uma revisão final do conjunto com 4 lentes e 2 céticos por achado): suíte de 1237 para 1315 testes, `tests/battery-fix-*.test.mjs`; typecheck, build e `--self-test` do Mac ok.
  - **Segurança (alta):** ordem por Touch ID agora carrega no pedido assinado o valor que o dono viu (`expected`/`after`); se o valor atual mudou, é recusada com `DIRECT_ORDER_CHANGED` (409), nunca recalculada. Mac antigo sem `expected`: orçamento só passa se a base não mudou. Erros da Graph guardados/retornados sem token (`account-limits` e `meta-live`, cópias do Supabase idênticas).
  - **Virada do dia:** depois da meia-noite, o corte "hoje" de ontem não é hoje para a sombra, o quadro, a fila e o resumo (N/D até a análise do novo dia); a regra da virada usa o corte de ontem declarado; a mesma perda não vira "3 dias" nem toca de novo no iPhone; "ontem" nunca é anteontem.
  - **Sombra:** nunca pausa e aumento executáveis no mesmo objeto (a pausa vence); qualquer venda conhecida (front, pedido ou receita) é venda; 2º dia com venda de ontem N/D e hoje zero é conferido sozinho; N/D nunca "null"; "Já fiz" do dono conta como dono; edição desfeita antes da decisão não conta; gasto N/D no dia seguinte é N/D; alerta sem pausa fora do placar; dia de cada projeto pelo próprio fuso; leitura MCP com `day` e campos `owner`/`grade`/`ruleLabel`.
  - **Fila/notch/web:** IN_PROCESS não é pausa; leitura sem `lastSyncAt` não desfaz pausa confirmada; reativação traz de volta; contador "X de Y" sem as pausadas; web igual ao notch.
  - **iPhone:** último erro fica até um envio dar certo; perda comparada só na mesma janela, base e dia; ordens primeiro.
  - **Avisos de mudança:** cada edição uma vez, mesmo no mesmo segundo; pulso de ordem descreve a ordem certa; "Já fiz" com orçamento N/D fica "A conferir"; nome da campanha nas ordens do notch.
  - **Mac:** em reunião e nas notificações, prioridade ordem > proposta > perda > gestor; contador ilegível é N/D (sem som falso).
- **Pendentes para o dono:** (1) ~~confirmar a base D da regra 6~~ — confirmada pelo dono em 09/11/2026: a regra 6 (virada do dia) é avaliada pelo próprio dia D. (2) Limite conhecido do som: ajuste fora dos 12 mais recentes pode não tocar quando outro do mesmo tipo sai das 24h na mesma leitura (precisa de contador do servidor). (3) Os números do backtest de 08/11 ("reduzir em dia ruim" 36–43%) usaram o proxy antigo (ROI < 0,7); o proxy agora segue a v2. (4) Entre a meia-noite e a primeira análise do dia, um teste novo que só gastou ontem sai da fila até a nova análise (N/D, sem rótulo errado).

### 09/11/2026 — Ação rápida na sombra do notch

- Pedido do dono: agir direto nas linhas antecipadas pelo Bunk (Agora › Sombra do Bunk) para ficar mais rápido.
- `shadowSummary` (`lib/autonomy-shadow.mjs`) passa `projectId`, `adAccountId` e `objectId` em cada linha recente (só identificadores; a sombra continua sem executar nada).
- Notch: cada linha ainda não tratada (sem ação do gestor nem do dono) ganha um botão "Pausar", "Aumentar N%" ou "Reduzir N%" (`AdjustPreset.from`, `ShadowActionButton`). O botão só abre a ordem direta da campanha com essa ação já escolhida. O valor ao vivo e os bloqueios aparecem como antes, e nada é enviado sem "Executar agora" com Touch ID (mesmo fluxo da ordem direta de 07/11). Ativação não ganha botão, e percentual fora dos limites do servidor também não.

## Notch: fixar aberto (registro escrito às 2026-11-09 12:32:10 UTC por `date -u`)

- Pedido do dono: poder deixar o notch expandido quando precisar.
- Botão de alfinete no cabeçalho, ao lado do X. Fixado, o notch não fecha ao clicar fora nem após 45 s de inatividade; avisos novos esperam na fila.
- X, Esc (com o notch em foco) ou ⌥⌘B fecham e soltam o alfinete; a próxima abertura volta ao comportamento normal.
- Lógica em `IslandFSM` (entrada `.fix`, estado `fixed`) com casos no self-test. Somente leitura de interface: nenhuma mudança em campanhas, executor ou segredos.
- Validação: `mac/build.sh` (self-test ok, app reinstalado e reaberto) e testes Node que leem o Swift. Conferência visual fica com o dono.

## Meta ao vivo junto do Malva no web e no notch (registro escrito às 2026-11-09 12:39:54 UTC por `date -u`)

- Pedido do dono (09/11/2026): usar o token da Meta junto do Malva, associando a campanha pelo id, para os números do tráfego e a atualização depois de pausar ficarem mais rápidos, no web e no notch. Medido antes: o Malva estava cerca de 7 min atrás (`lastSyncAt` 12:17 numa leitura das 12:24); 526 campanhas ativas em ~130 contas.
- Leitura (`lib/meta-live.mjs`, cópia na Edge Function `meta-read`): somente GET; agora todas as campanhas Meta ativas (novas e programadas primeiro, depois maior gasto), com status, orçamento diário, cliques e cliques no link; 8 contas em paralelo, até 600 campanhas/160 contas; campanha que saiu da lista de ativas é lida pelo id (até 40); limite de chamadas da Meta suspende 10 min.
- Executor: a leitura saiu do ciclo pesado de 2 min para a via rápida, a cada 1 min e logo após uma ordem do dono (mín. 10 s); a cada leitura nova reconstrói o resumo do notch e move o pulso (o web recarrega). Ação `metaLive` do objeto serve a última leitura ainda válida (10 min).
- Exibição (`lib/meta-display.mjs`): status/orçamento da Meta quando a leitura dela é mais nova que a do Malva; gasto, impressões e cliques quando à frente no mesmo dia; razões recalculadas com as fórmulas do Malva (ROAS = receita líquida/gasto; ROI = receita líquida − custos ÷ gasto + custos de anúncio); IC, pedidos e receita continuam do Malva, IC/compras do pixel à parte. Web: `/api/live` e o relógio "Meta ao vivo · HH:MM". Notch: números do dia, placar e detalhe da campanha ("Meta ao vivo há X min"); a fila continua na análise.
- Fora do alcance de propósito: análise, propostas, aprovações, contingência e conferência de ordem continuam só com o Malva (teste garante). CLAUDE.md e `docs/connections.md` atualizados com a decisão.
- Pendente: confirmar em produção a duração e o número de chamadas de uma leitura completa (`metaLive.ms`, `requests`) e que a Meta não devolve limite de chamadas no ritmo de 1 min.

## Nova bateria de aprimoramento: 7 frentes, 31 achados (registro escrito às 2026-11-09 12:48:55 UTC por `date -u`)
- **Pedido do dono:** "Nova bateria de testes para aprimoramento". Foram 7 buscadores só de leitura, com prova por script. As correções foram feitas só nos arquivos livres; a outra sessão ativa tinha edições locais no worker, no notch, em meta-live, companion-summary, reading-context, bunker.tsx e api/live.
- **Ordens do dono:**
  - Uma falha antes do envio, com tentativas restantes, agora aparece como "Ainda não enviada · nova tentativa do executor pendente" e continua bloqueando uma segunda ordem. Antes aparecia "Não enviada" e o executor ainda a retomava.
  - O reenvio de uma ordem já registrada recebe o próprio recibo antes da leitura ao vivo e da contingência.
  - As ordens podadas levam junto as suas execuções; antes, 200 execuções órfãs travariam o executor.
  - Orçamento resultante acima de 1e9 é recusado.
- **Fila de decisões:**
  - Um teste iniciado ontem à noite mantém a prioridade de teste novo quando todo o gasto anterior é de ontem.
  - "TESTE" só conta como palavra inteira (TESTEMUNHO não conta). O aquecimento passa a aceitar dígitos e plural.
  - Sem leitura ao vivo, a lista ordena pelo gasto da análise e põe o teste novo sem vendas primeiro.
  - A trava de orçamento vale entre projetos que compartilham a conta.
  - Um incidente de outra campanha da conta não rebaixa o resultado.
  - O provider é comparado sem diferenciar maiúsculas.
- **Ritmo e previsão:**
  - A previsão limita o gasto restante ao orçamento diário conhecido.
  - Um projeto "spent" projeta o que já gastou.
  - O ritmo só usa leitura de hoje completa da Malva.
- **Vendas e contas:**
  - Estornos em outras grafias (chargedback, charged_back, devolvido, protested, overdue…) não contam como venda.
  - Valores BR/US agrupados ("1.297,00", "1,297.00", "R$ 297") são lidos; os ambíguos seguem N/D.
  - A deduplicação e a "última hora" vão além das 40 vendas mostradas (`seen`, 1000 refs).
  - A hora de pagamento vence a de criação.
  - Moeda ausente no painel de contas aparece como "moeda N/D", não US$. Texto vazio vira N/D, não 0.
  - Janelas novas exigem data ISO com fuso; em produção todas já vêm com Z.
- **Segundo lote (a outra sessão publicou 7dde4d9 e liberou os arquivos):**
  - Executor: depois da faixa rápida do alarme, a configuração é relida; uma pausa enviada nesse meio-tempo vence (nada pesado roda, o alarme não é reagendado) e o pulso grava \`runtime\` a partir de uma leitura nova, sem apagar o histórico da faixa. Teste em \`tests/executor-fast-lane.test.mjs\`.
  - Notch, ação rápida: o botão só aparece quando o Bunk executaria agora — \`wouldExecute\`, \`blockedBy\` vazio (teto do dono, pausa que prevalece), sem "só alerta" e reemitido pela última passada da sombra (\`current\`, a partir de \`shadowStatus.at\`; servidor antigo, sem a marca, não ganha botão). O resumo passou a trazer \`lastAt\`, \`current\` e \`alertOnly\`.
  - Ponto para o dono: \`recordDirectOrder\` não confere o teto de orçamento do dono (a sombra confere). O botão não oferece mais esse caso, mas uma ordem digitada à mão acima do teto ainda passa.
- **Desfeito de propósito:** o incidente encerrado mais recente da própria campanha continua valendo sobre um incidente geral aberto, como manda o teste existente. A contingência segue conservadora.
- **Limites conhecidos:** a pesquisa recomenda não mexer agora (som fora dos 12 mais recentes: depois, com o próximo build do Mac; data no nome a 61–182 dias: não vale; fila entre meia-noite e a análise: coberta por "Primeiras 24h").
- **Pendências:**
  - Abertas: cards por projeto duplicados em "Todos" para conta compartilhada; o `cardDecision` e o `proposalReview` recusam o reenvio pela revisão antes da checagem de replay (achado só por leitura).
  - Melhorias do executor: `freshChanges` compartilhado, get/put concorrentes em runtime, `watchChanges` com pausa central.

## Sombra reavaliada a cada leitura (registro escrito às 2026-11-09 14:53:31 UTC por `date -u`)

- Relato do dono em 09/11: precisou pausar à mão testes novos que a sombra deveria ter apontado antes.
- Causa técnica: a regra `test-no-sale` só rodava no fim do pulso pesado, que demorava por causa das etapas de modelo. A leitura Meta chegava a cada minuto, mas a sombra não. Agora `queueShadow` roda as regras a cada leitura Meta nova (`metaTick`) e a cada releitura Malva da faixa rápida, em fila (nunca duas ao mesmo tempo). Falha entre pulsos mantém as entradas guardadas; o pulso pesado continua registrando falha. `shadowStatus.ms` mede a duração.
- Parte das pausas do dono ocorreu abaixo do ponto de pausa da sombra e, com 2+ IC, abaixo do limiar privado do projeto; dois projetos configurados não estão na política privada da sombra. Ajustar limiares ou incluir projetos é decisão do dono — pendente, nada alterado.
- Não muda execução: continua sombra, sem envio automático.

## Limiares da sombra alinhados às pausas do dono (registro escrito às 2026-11-09 15:44:41 UTC por `date -u`)

- O dono aprovou no chat alinhar a sombra com as pausas dele: ponto de pausa mais cedo com 0–1 IC, limiar menor para 2+ IC e inclusão dos dois projetos que estavam fora.
- Como `AUTONOMY_SHADOW_POLICY` não pode ser lido, a decisão foi gravada num secret à parte, `AUTONOMY_SHADOW_OWNER` (`ownerShadowPolicy` em `lib/autonomy-shadow.mjs`): só reduz valores, liga projetos listados e respeita projeto desligado. Campo novo `first24hLowIcPauseAt` em `lib/first-24h.mjs`.
- Continua sombra: nada é executado sem o dono.

## Memória da Sombra: aprender com tudo, além de 7 dias (registro escrito às 2026-11-09 15:57:07 UTC por `date -u`)

- **Pedido do dono:** "aprimore a aprendizagem do bunk, ele deve ficar mais inteligente a cada hora, dia… a ponto de já vir com decisões precisas e prontas". Depois pediu também bases de conhecimento e repositórios externos.
- **Achado:** a Sombra apagava as decisões com mais de 7 dias, inclusive as notas do dia seguinte. O placar que libera as regras de orçamento só via ~5 dias avaliados, ou seja, o Bunk esquecia toda semana. Também não havia comparação com a base ("não fazer nada"), nem registro do que gestor ou dono cortou sem aviso prévio da Sombra.
- **Mudança:**
  - `lib/shadow-learning.mjs` guarda por 90 dias as decisões com nota final, os pontos cegos e a base de cada dia × projeto, nas chaves `learn:<dia>:<projeto>` do Durable Object.
  - O executor grava essa memória a cada passada da Sombra e monta o `learningSummary`. Ele inclui acerto com faixa provável, recência, estimativa de projeto pequeno puxada para a regra, acerto contra não fazer nada com a chance de ser melhor, tendência de 7 dias, gasto mediano das pausas certas e erradas, gestor antes ou depois, e lições.
  - A trava 60%/20+ do dono lê a memória da versão atual das regras.
  - A leitura MCP `shadow` devolve `learning` e `learningStatus`. O notch mostra a linha "Memória" e a primeira lição.
  - Método e referências externas: `docs/autonomy-policy.md`, "Memória da Sombra".
- **Testes:** `tests/shadow-learning.test.mjs` (9, incluindo o executor de ponta a ponta) e o harness de `tests/battery-fix-worker.test.mjs` com o módulo novo. Resultado: suíte 1368/1368, typecheck, build e autoteste do notch.
- **Ponto para o dono (não aplicado):** nas regras de aumento, 60% de acerto pode empatar com a base, porque no backtest 60% dos dias seguintes deram lucro. A opção de exigir "vencer a base com ≥ 90% de chance" está calculada, mas só entra se o dono aprovar.
- **Pendências:**
  - Nota provisória em D+1 e final em D+3, por causa do atraso de atribuição.
  - Usar as lições como contexto das análises dos agentes.
  - Limiar de pausa por projeto aprendido do histórico (curva de primeira venda por gasto), sempre como proposta ao dono.
- Pontos cegos contam só o que a Sombra avalia: campanhas Meta de vendas (`shadowObjects`). Ficam de fora conjunto, anúncio, aquecimento e outra plataforma. A contagem do notch soma só cortes; aumentos sem aviso ficam à parte (`blindSpots.increases`).
- Continua sombra: nada é executado sem o dono.

## Teto do dono nas ordens digitadas à mão (registro escrito às 2026-11-09 16:24:40 UTC por `date -u`)

- Decisão do proprietário de 09/11/2026 ("Yes, check the cap"): a ordem direta do notch e a ordem do card passam pelo mesmo teto de orçamento diário que a Sombra usa (`budgetCaps[conta]`, senão `budgetCap`). Regra em `lib/owner-budget-cap.mjs`; a política vem dos secrets do Worker por `lib/owner-policy.ts` (só leitura em memória, nunca impressa nem devolvida).
- Aumento acima do teto: recusado antes de gravar (`DIRECT_ORDER_CAP` na ordem direta; erro com o mesmo texto no card), com o maior percentual possível. Redução, pausa, "Pedir à equipe" e "Já fiz" não são limitados. Sem teto configurado, sem limite (como antes). Reenvio de ordem já registrada devolve o recibo sem nova conferência.
- O notch recebe `budgetCap` / `orderBudgetCap` (valor, moeda, aumento máximo), mostra "Seu teto" e desliga só "Executar agora"; no teto, "Aumentar" fica indisponível.
- Conferido em produção (09/11/2026): nenhum projeto tem teto configurado (a Sombra mostra "Teto de orçamento do dono não definido" em Gabe, John, Leandro, Murilo e Nico). Decisão do proprietário de 09/11/2026 ("Deixar sem teto"): continuar sem teto por enquanto. A regra fica pronta e só limita quando ele definir valores; não criar nem alterar o secret da política sem valores dados por ele.

## Módulo de autonomia do Bunk (registro escrito às 2026-11-09 16:34:21 UTC por `date -u`)

- **Pedido do dono (09/11/2026):** "Hoje vamos iniciar o modulo de autonomia do bunk ... Vou setar o que ele pode fazer". Escolhas dele: 4 níveis (Desligado · Sombra · Confirmar · Automático), projeto + exceções por campanha, permissões para pausar/reduzir/aumentar/reativar, placar da Sombra respeitado.
- **Feito:** `lib/autonomy-grant.mjs` (permissões, conferência por decisão, ordem do Bunk), menu web "Autonomia do Bunk" (`app/autonomy-panel.tsx`), gravação só pela rota do dono (`autonomyConfig`/`autonomyKill` em `/api/state`), registro em `/api/autonomy` (ação `autonomy` do objeto). O executor, depois de cada passada da Sombra, cria ordem só no modo Automático, dentro dos limites, com o valor ao vivo da Malva igual ao da decisão, e acorda a faixa rápida; a ordem segue claim → prepare → submit único → releitura → confirm. Interruptor, impressão digital da permissão e modo Automático da campanha são conferidos de novo na reserva, na pré-conferência e no envio. Recibos com `by:'bunk'`. Detalhes em `docs/autonomy-policy.md`.
- **Estado:** interruptor geral desligado e nenhum projeto configurado: em produção nada muda até o dono salvar permissões e ligar. 1381 testes, typecheck e build ok; 9 testes novos (`tests/autonomy-grant.test.mjs`); painel conferido no preview local com central fictícia.
- **Antes do primeiro Automático (pendente):** registro explícito do dono no `CLAUDE.md` (regra atual exige), rótulo "Bunk" nos recibos do notch e aviso no iPhone para ordens do Bunk, conferência do interruptor também na Edge Function `malva-mcp`. Reativar não tem regra na Sombra ainda. Dois projetos configurados seguem fora da política privada da Sombra: ali nenhum nível age.
- **Registro no CLAUDE.md (2026-11-09 16:38:15 UTC):** o dono respondeu "Sim, registrar". A regra de autonomia do `CLAUDE.md` agora libera a ordem do Bunk só no modo Automático, com o interruptor geral ligado e dentro das ações e limites salvos pelo dono. O interruptor continua desligado; ligar é decisão dele no painel.
- **Ajustes de segurança antes do primeiro Automático (2026-11-09 16:42:21 UTC, pedido do dono "Sim, fazer agora"):** (1) guarda de envio (`lib/cloud-dispatch-guard.mjs` e a cópia da Edge Function) recusa ordem do Bunk com o interruptor desligado; Edge Function `malva-mcp` publicada como v12 (mesmos arquivos da v11 mais essa checagem, `verify_jwt` mantido). (2) Avisos de ordem do iPhone (`orderAlertTitle` em `lib/phone-alerts.mjs`) e do Mac (`Format.orderAlertTitle`) dizem "Bunk (autonomia): …". O envio ao iPhone depende do Pushover, que segue sem configurar (`phone.configured:false`). (3) Notch: recibo do Bunk aparece como "Bunk · campanha" com a regra, e a seção vira "Ordens · 24h" quando há ordem do Bunk. Testes 1383 ok, typecheck ok, `mac/build.sh` com self-test ok e app reinstalado.
- **Campanha em dois projetos (2026-11-09 19:38:57 UTC, aviso da sessão "Bunk aprendizagem contínua"):** limite diário, intervalo de 1h e checagem de ordem a caminho em `lib/autonomy-grant.mjs` passam a contar pela campanha Meta (conta + objeto), não pelo projeto. Uma campanha presente em dois projetos que dividem a conta recebe no máximo uma ordem do Bunk por passada. Teste novo em `tests/autonomy-grant.test.mjs`; 1397 testes ok, typecheck e build ok; commit `36b8a56`, Worker `406cd12c`, `/health` 200.

## Aprendizado com as ações do dono e dos gestores; memória revisada (registro escrito às 2026-11-09 19:03:16 UTC por `date -u`)

- **Pedido do dono:** "toda ação que eu for fazendo, Jorge e Leonardo, ele deve ir aprendendo junto para melhorar as sugestões". Ele pediu também bases externas, cuja síntese está em `docs/autonomy-policy.md`, "Memória da Sombra".
- **Contexto novo:** desde `0419c1e` o modo Automático envia ordens reais a partir do "executaria" da Sombra. Por isso, esta rodada passou por duas revisões adversariais (49 e 39 agentes; 37 e 31 achados confirmados, todos tratados) antes de publicar.
- **Trava das regras de orçamento:** a contagem de 7 dias decide, e só conta decisões da versão atual das regras.
  - A versão vem do carimbo `ruleVersion`, gravado em `mergeShadow`. Decisão sem carimbo é v2 quando nasceu depois de 08/11 18:48 UTC (`entryRuleVersion`).
  - A memória longa só pode vetar. Memória ausente, de outra versão ou com mais de 2 h mantém a regra como sugestão nessa passada: falha fechado.
  - As mensagens da trava dizem o motivo.
- **Aprendizado com pessoas** (`lib/team-learning.mjs`, chaves `learn:<dia>:<projeto>:team`, 90 dias, no DO): cada pausa, ativação ou mudança de orçamento diário, sua ou de gestor, é guardada com:
  - quem fez: "Você" pelo notch, pelo "Já fiz" ou pelo seu nome Malva (lido da identidade da conexão, só no DO); gestores pelo nome; "Fora da Malva Dash" quando a edição foi feita no Gerenciador;
  - os números Malva do momento, de leitura com até 45 min de distância;
  - o que a Sombra tinha apontado e com quantos minutos de antecedência;
  - o ponto de pausa da Sombra, para campanha nova no 1º ou 2º dia;
  - a nota do dia seguinte, para orçamento e ativação.
- **O que fica de fora:** as ordens automáticas do Bunk e o eco delas. Um eco guardado por uma passada com estado antigo é removido por descrição na passada seguinte. Ficam de fora também a Meta, as automações e as mudanças sem autor.
- **O que o Bunk mostra:**
  - Por pessoa: pausas de campanhas novas sem venda com gasto mediano, ajustes confirmados pelo dia seguinte e antecipação da Sombra contra a semana anterior.
  - Pontos cegos: cortes que a Sombra não apontou, contados só nas horas em que ela avaliou o projeto (`learningCoverage`).
  - Propostas de limiar, só texto para o dono. Exigem 5 ou mais pausas em 5 ou mais campanhas e 3 ou mais dias, e comparam com o ponto de pausa em vigor.
  - No notch: aba Gestores, "O que o Bunk aprendeu com vocês"; e a linha Memória, que mostra N/D em vez de 0% e aparece também em dia sem decisão.
- **Memória (`learningPolicy` v2):**
  - a base só conta campanhas que já rodavam antes do dia, e é congelada na primeira leitura;
  - lições e números do notch usam só a versão atual das regras;
  - a vantagem exige 10 ou mais decisões, 5 ou mais campanhas e 3 ou mais dias;
  - a tendência só aparece com diferença significativa;
  - o texto compara com "uma campanha qualquer do mesmo dia", não com "não fazer nada".
- **Testes:**
  - `tests/shadow-learning.test.mjs`: 12 testes, incluindo o executor de ponta a ponta com veto, retenção, ponto cego e segunda passada;
  - `tests/team-learning.test.mjs`: 10 testes;
  - suíte 1396/1396, typecheck, build e autoteste do notch.
- **Decisões do dono pendentes:**
  - se a trava deve exigir também "vencer a base com ≥ 90% de chance" ou uma condição de recência;
  - se edições "Fora da Malva Dash" podem ser atribuídas a pessoas pelo perfil da Meta. Hoje não são, por desenho.
- **Pendências técnicas:**
  - nota provisória em D+1 e final em D+3;
  - lições da Sombra como contexto das análises dos agentes de IA;
  - o pulso pesado ainda passa à Sombra o estado lido no início. A autocorreção cobre os ecos, mas uma releitura antes da Sombra seria mais limpa.
- Continua: nada muda limiar e nada é executado por causa do aprendizado.
- **Terceira verificação (2 céticos, antes de publicar).** O cético da trava rodou 20 mil cenários contra o HEAD anterior: as decisões não mudam, só o texto da trava. Corrigido depois:
  - **Aprendizado lê as fontes brutas:** feed de edições da Malva, "Já fiz" e execuções. Não usa mais o `activityLog` fundido, que dobrava um "Já fiz" dentro da edição de um gestor com nome e absorvia a ação de uma pessoa numa ordem do Bunk dentro de ±3 h.
  - **Eco de ordem:** só a transição exata, de ordem enviada, dentro da janela de envio e pela sua conexão Malva ou sem nome. Gestor com nome nunca é eco. Suas ordens contam pela execução.
  - **"Já fiz":** casa com a edição sem nome ou com o seu nome mais próxima antes do toque. O apelido (alias) vale por projeto.
  - **Trava:**
    - decisão de campanha compartilhada entre projetos conta uma vez, e prevalece o erro;
    - nota nova de regra travada refaz a memória na hora;
    - uma falha da memória mais nova que o resumo mantém as regras como sugestão.
  - **Avisado à sessão "Módulo de autonomia do Bunk":** a ordem do Bunk pode sair duplicada quando a mesma campanha está em dois projetos (código de autonomia, já existente; não alterado aqui). E, por desenho do dono, `morning-increase` só passa pela trava em campanha nova.
- **Publicação e conferência em produção.** Commit `7fb5702`, versão Cloudflare `adf3aa06`, depois `406cd12c`/`721dcdd1` da sessão de autonomia por cima (contêm este commit). `/health` 200. Notch reinstalado (`7fb5702`, autoteste ok).
  - Depois de três reinícios seguidos do DO (19:36–19:40 UTC), a Sombra ficou ~12 min sem passar. Ela só volta depois que o pulso pesado termina as etapas de modelo e a leitura ao vivo, porque `liveItems` some no reinício e o `metaTick` depende dele. É um comportamento anterior a esta rodada. Voltou às 19:48:48.
  - Leitura MCP `shadow` às 19:49 UTC:
    - `learning` v2 (`ruleVersion` 2);
    - 174 ações de pessoas guardadas, 136 únicas em 30 dias, distribuídas entre o dono, dois gestores e "Fora da Malva Dash";
    - placar da versão atual 0/0: as 53 decisões avaliadas são de antes da v2 e não contam;
    - pontos cegos 1, agora só em horas observadas.
  - Pendente de observar: as primeiras notas da v2 (a partir de 10/11) e a primeira proposta de limiar, quando houver ≥ 5 pausas em ≥ 5 campanhas e 3 dias.

## Leitura da Sombra no pacote dos agentes de IA (registro escrito às 2026-11-09 21:21:36 UTC por `date -u`)

- **Pedido do dono:** "Sim, fazer aqui", depois da proposta de levar os padrões aprendidos às análises dos agentes.
- **O que mudou:** `context.shadowLearning` nos pacotes dos agentes (detalhes em `docs/agent-learning-cycle.md`, versão 14).
- **Revisão:** adversarial, 15 agentes, 8 achados confirmados e corrigidos:
  - a ordem da compactação preserva a revisão de padrões;
  - a marca de adiamento não conta bytes;
  - N/D quando a Sombra não observava;
  - vantagem só com amostra mínima;
  - "o dono" no lugar de "Você";
  - propostas estruturadas e não aprovadas;
  - a profundidade da memória declarada.
- **Testes:** suíte 1403/1403, typecheck e build.
- **Pendente:** conferir em produção, no recibo de uma conclusão nova, se a leitura foi entregue ou adiada pelo tamanho do pacote.
- **Conferido em produção.** Commit `74eeff2`, versão `a90d3a20`. O histórico do executor agora mostra `shadowLearning` em cada estágio e revisão: entregue, encurtada, adiada (pacote cheio) ou indisponível.
  - Às 21:35 e 21:36 UTC, os estágios de tráfego e criativo do projeto Leandro receberam a leitura **entregue**, com pacotes de 149.018 e 155.558 bytes.
  - As falhas vistas depois do deploy já ocorriam antes desta mudança:
    - `CLOUD_AI_INVALID` (21:30), por repetição de espaços que estoura o limite de saída;
    - `CLOUD_MEMORY_REVIEW_EVIDENCE` (21:39), por `not_in_reflection`.
  - Pendente: acompanhar se a taxa de truncamento muda com a leitura no pacote.

## Diários fora da central (registro escrito às 2026-11-09 22:58:52 UTC por `date -u`)

- Relato do dono em 09/11: o notch avisou "Armazenamento central em 87% do limite" — "isso nunca deve acontecer".
- Causa: os diários só de acréscimo (`decisionHistory`, `decisionHistoryImports`, `campaignChanges`, `externalHistoryMeasurements`) viajavam dentro do registro `central` e cresciam a cada importação.
- Correção (`lib/history-storage.mjs`, `journalStorage`): cada diário é cortado em segmentos de tamanho fixo por posição, selados por SHA-256 em `history-journal:<hash>`, gravados na mesma transação do compare-and-swap da central. Segmentos antigos não são reenviados; nada é apagado; registro ausente ou alterado falha fechado (`STORAGE_INTEGRITY`); itens gravados inline por uma versão antiga ao lado do índice são preservados (mesmo id fica com a cópia indexada).
- Rollout em dois passos: leitor publicado primeiro (`5542242`) e confirmado no executor (`status.storageFormat.journalReader`) antes de ligar a gravação.
- Simulação com a central real: diários idênticos na volta; a central compactada cai para pouco mais da metade do limite.
- Pendente com o dono: as cópias antigas de leituras (`snapshots:<digest>`) não referenciadas se acumulam no banco a cada gravação; limpar é apagar dados e exige decisão dele.

## Retenção das cópias de leituras (registro escrito às 2026-11-10 03:22:16 UTC por `date -u`)

- Decisão do dono em 09/11 ("Yes, keep 24h"): cópias antigas de leituras (`snapshots:<digest>`) sem referência são apagadas, guardando as últimas 24h.
- `bunker_store` (migração `20261109231000_snapshot_retention.sql`, aplicada): no commit vencedor da central, apaga `snapshots:` gravados há mais de 24h, nunca o que a central nova referencia. A central é a única leitora desses registros (conferido: nenhum outro registro cita essas chaves).
- Limpeza única feita com a mesma regra, seguida de `VACUUM FULL` em `bunker_records` fora da cadência; a leitura da central e `/health` conferidos depois.

## Design system do notch e rodada de UX (registro escrito às 2026-11-10 03:39:11 UTC por `date -u`)

- Pedido do dono em 09/11: "100 baterias de melhorias no design system do notch", com referências externas (Apple HIG, DynamicNotchKit, Boring Notch, NotchNook, Alcove), seguidas de "100 rodadas de testes e aprimoramento na UIX, usabilidade". Feito como duas listas fechadas de 100, sem ciclo aberto. Só apresentação: regras, números, fluxo de ordem/Touch ID e ações dos botões não mudaram.
- `DesignSystem.swift` reescrito em três camadas:
  - `Palette`: valores crus, cada um com gêmeo de Aumentar contraste;
  - `Token`: papéis nos dois modos;
  - `DS.*` e componentes: `TintChip`, `Monogram`, `PressableStyle`, `Banner` com glifo por tom, `EmptyLine` claro/info/espera, `SkeletonBlock`, `scrollEdgeFade`, `numericTransition`.
- `DSAudit` entrou no `--self-test`: contraste AA de cada texto e tom nos dois modos, piso de 10 pt, grade de 4 pt, raios concêntricos e alvos de clique de pelo menos 20 pt.
- Aplicado nas telas:
  - indicador de aba deslizante;
  - números que rolam ao mudar;
  - lista com fade na borda;
  - esqueleto no carregamento;
  - aro sutil na ilha aberta e halo no aviso;
  - passar o mouse e pressionar em todos os botões;
  - dicas com o texto completo em linhas truncadas;
  - botão de limpar na busca de contas;
  - alvos pequenos aumentados.
- Detalhes, inventário e as duas listas: `docs/notch-design-system.md`. UX: 45 itens passavam, 49 foram corrigidos e 6 ficaram para depois.
- Validação:
  - `mac/build.sh` compilou e passou no autoteste; o app foi instalado em `~/Applications`;
  - a reabertura automática deu `-600` no `open` e o app foi reaberto à mão (está rodando);
  - capturas antes/depois feitas pelo `--render-notch` (16 telas fictícias);
  - a captura real do topo da tela saiu preta (tela bloqueada ou sem permissão de gravação), então a conferência visual da instalação fica pendente com o dono.
- Para depois (lote E e ⏳ da UX):
  - botões de ícone de 28 pt;
  - anel de foco de teclado;
  - háptico e atraso de abertura;
  - altura dinâmica;
  - prévias de alto contraste e Reduzir movimento no renderizador;
  - janela de sons com os componentes da ilha.

## Executor reiniciado por estouro de CPU (registro escrito às 2026-11-10 09:40:00 UTC por `date -u`)

- **Pedido do dono:** "bunk não conseguiu ler nada". O Bunk do notch mostrava "Não consegui ler o Bunker agora": `/api/companion` respondia 503 quando o objeto do executor era reiniciado.
- **Causa:** desde 09/11 ~16h UTC o objeto passou a estourar o teto de CPU (`exceededResources`) e às vezes a memória (`exceededMemory`), várias vezes por hora (analytics do Cloudflare). A Sombra entre pulsos (09/11) passou a refazer também a memória longa de 90 dias a cada leitura da Meta. Isso rodava dentro da invocação longa do pulso pesado, que tinha o teto padrão de 30 s de CPU.
- **Feito:**
  - Entre pulsos, a Sombra continua a cada leitura: decisões, status e autonomia. A memória longa só é refeita no pulso pesado ou se tiver mais de 5 min (`betweenPulseLearnMs`).
  - `limits.cpu_ms:300000` no build Cloudflare (plano Standard).
  - Notch: uma falha isolada (5xx ou rede) logo depois de uma leitura boa tenta de novo em 15 s, sem mostrar erro; a segunda seguida aparece.
- **Testes:** `tests/executor-cpu-budget.test.mjs` e o autoteste do app.
- **Acompanhar:** contagem de `exceededResources`/`exceededMemory` nas próximas horas. Se `exceededMemory` persistir, o próximo passo é reduzir as cópias do estado mantidas ao mesmo tempo.

## Notch fora do lugar com quatro telas (registro escrito às 2026-11-10 09:47:42 UTC por `date -u`)

- Relato do dono em 10/11 ("o notch bugou"): a ilha recolhida apareceu à esquerda do monitor principal, em cima dos menus.
- Medição:
  - escolha de tela `menuBar`, com o monitor L2717REC de 1920 pt;
  - 4 telas conectadas, uma delas duplicada no nome;
  - janela do notch em x = 0 em vez de x = 610.
- Causa: com monitores dormindo, acordando ou sendo reorganizados, o macOS moveu o painel, e o app só reposicionava ao receber o aviso de mudança de telas.
- Correção (`NotchController.swift`):
  - a cada 1,5 s, `healPosition()` confere `NotchGeometry.drifted` (tolerância de 0,5 pt) e devolve o painel ao centro da tela escolhida;
  - um segundo reposicionamento roda 1,2 s depois de cada aviso de mudança de telas;
  - o modo seguir-o-mouse continua como estava.
- Autoteste com o caso real (painel em x = 0 contra 610 esperado). Reinstalado: a janela voltou para x = 610. Não alterou o design nem os dados.
- **Memória (registro escrito às 2026-11-10 10:00:31 UTC por `date -u`):** depois do teto de CPU, o objeto ainda era reiniciado por memória (3 vezes em 9 min). Cada `read()` reidrata a central inteira (~15–20 MB de JSON). A leitura ao vivo fazia isso uma vez por projeto lido, e o tick da Meta duas vezes seguidas, enquanto o pulso pesado segurava a sua própria cópia. Agora os leitores que não gravam usam `view()`, uma cópia compartilhada por revisão da central, conferida antes por uma leitura barata da revisão: a leitura ao vivo, o tick da Meta, a faixa rápida e o resumo do notch. `write()` e o motor continuam com cópia própria, e um commit descarta a compartilhada. Os construtores alimentados por ela foram testados sobre estado congelado (`tests/shared-view-readonly.test.mjs`).
- **Memória, medida (registro escrito às 2026-11-10 10:15:48 UTC por `date -u`):** a central real reidratada localmente ocupou ~40 MB de heap por cópia (as leituras e o histórico são o maior peso). O motor do pulso segurava duas cópias durante a chamada ao modelo: a do início do passo e a releitura após a reserva. Agora `lib/cloud-engine.mjs` solta a primeira antes de reler, na coleta e nas etapas. A cópia compartilhada de `view()` é descartada após 20 s sem uso. Não cortei campos da cópia de leitura: os construtores do notch importam módulos que usam esse histórico.
- **Estado às 2026-11-10 10:38:55 UTC (`date -u`):**
  - Sem `exceededResources` desde o teto de CPU.
  - O notch só recebeu 200 em `/api/companion` e no pulse em cerca de 40 min de observação.
  - As etapas dos analistas seguem concluindo.
  - **Pendente:** o objeto ainda é reiniciado por memória a cada ~7 min. Medido localmente com a central real: uma cópia hidratada precisa de ~45–60 MB de heap e duas de ~100 MB, num isolate de 128 MB. Desde que o histórico (ledger, outcomes, diários) saiu da central, o limite de 1,75 MB da central não segura mais o tamanho em memória. Os maiores itens são `snapshots` 9,0 MB de JSON, `historyLearning` 7,7 MB, `decisionHistoryOutcomes` 4,0 MB, `decisionHistory` 3,4 MB e `decisionHistoryImports` 1,7 MB.
  - **Próximo passo:** limitar o histórico mantido em memória ou carregar só o necessário por leitor, com auditoria do que cada construtor usa. Não foi feito sem essa auditoria.
- **Memória: leitura enxuta e menos cópias (registro escrito às 2026-11-10 13:58:29 UTC por `date -u`, commit efd41a0):**
  - Pedido do dono: resolver os reinícios por memória ("Sim, resolver memória").
  - Medido na central real: 31 MB de JSON, ~43 MB de heap por cópia. O registro de mudanças (`historyLearning.changes`) tem ~18 mil itens, 15,5 mil dos últimos 7 dias, e cresce ~2 mil por dia até o teto de 30 mil.
  - **Leitura enxuta** (`leanHistory` em `lib/history-storage.mjs`, `readPersistedState(...,{lean:true})`): a cópia compartilhada `view()` carrega `decisionHistory` e `campaignChanges` e deixa nos seus registros o registro de mudanças, as provas dos desfechos medidos, os recibos de importação e as medições externas. Passou de 43 para 24 MB, com a mesma pressão de armazenamento no notch.
  - Auditoria: nenhum leitor de exibição (notch, resumo web, Sombra, painel de contas, primeiras 24h) alcança esses campos (`tests/lean-view.test.mjs`).
  - **Trava:** estado enxuto nunca é gravado. Ele mantém os índices e a marca `historyStorage.lean`, e `packHistoryState` recusa qualquer índice do registro de mudanças sem as mudanças carregadas.
  - **Cópias rasas:** `persistHistoryLearning` e `persistExternalLearning` não copiam mais a central inteira; só trocam listas de topo.
  - **Motor:** a coleta solta a leitura e o rascunho antes do commit; a etapa de análise solta a cópia completa logo após a resposta do modelo, antes das gravações.
  - Pico medido localmente, heap limitado, dados reais: gravação da via rápida de 100 para 85 MB; coleta de mais de 115 para 85 MB.
  - **Ainda não coberto:** durante a espera do modelo, o motor segura uma cópia completa, porque o contexto da análise usa o histórico inteiro. Se uma gravação da via rápida (ordem do dono, conferência ou autonomia) ocorrer nesse intervalo, o pico ainda passa de 115 MB.
  - **Próximo passo se os reinícios persistirem:** reler a central só depois do modelo, o que muda a semântica da evidência e precisa de decisão; ou ajustar `hotDays` do registro de mudanças, o que muda o aprendizado e é decisão do dono.
  - **Resultado em produção (registro escrito às 2026-11-10 14:48:54 UTC por `date -u`):** publicado às 14:00:28 UTC. Entre 14:05 e 14:48 houve 2 reinícios por memória (14:14 e 14:27), contra ~1 a cada 7 min antes. O notch recebeu só 200 em `/api/companion` e no pulse. As etapas dos analistas e uma ordem confirmada pela via rápida seguiram normalmente.
  - **Ainda pesa:** o executor roda no mesmo script que o site inteiro (`dist/server` tem 18 MB), e esse código ocupa memória do mesmo isolate de 128 MB. Separar o executor num Worker próprio é a maior folga possível, mas é mudança de arquitetura e de deploy, para combinar com o dono.
- **Memória: espera do modelo (registro escrito às 2026-11-10 15:40:40 UTC por `date -u`, commit 38b48da):**
  - O dono respondeu "Faz o que é melhor e mais preciso para o projeto sem perder a qualidade". A aba Dias ficou publicada, e o próximo passo foi o que não muda nenhum resultado.
  - Antes de `runCloudAnalyst`, a etapa de análise guarda da mesma leitura só `snapshots`, `collaborationRounds` e `collaborationMessages`: é tudo o que `normalizeCampaignReadings`, `normalizeAgentReflection`, `cloudEvidence` e `findRound` leem depois. A cópia completa é solta durante a espera.
  - Não há releitura: a resposta é conferida contra os mesmos dados que o modelo viu. Os testes travam que a cópia completa não é lida depois da chamada e que essas funções não leem outro campo.
  - Medido localmente (espera do modelo + cópia de exibição + gravação): de 125 para 100 MB.
  - **Produção:** publicado às 14:54:49 UTC. Entre 15:00 e 15:40 houve 1 reinício por memória (15:19), contra ~1 a cada 7 min no início do dia e ~1 a cada 20 min depois da leitura enxuta. O reinício de 15:07 foi troca de código (deploy de outra sessão). O notch só recebeu 200.
  - **Restante:** ainda há picos raros. A maior folga seria tirar o executor do script do site (18 MB de código no mesmo isolate), mas isso exige outro Worker, com bindings e segredos próprios, e cabe ao dono decidir.

## Notch: aba Dias, resultado por dia (registro escrito às 2026-11-10 13:54:56 UTC por `date -u`)

- Pedido do dono: ter no notch a tabela diária (dia, investimento, vendas, CPA, faturamento líquido, lucro, ROAS, ROI).
- Fonte: Malva `tracking_series` (dia a dia, últimos 7 dias com hoje parcial, Meta, vendas de tráfego), uma leitura por projeto configurado a cada 10 min pelo executor (`syncDays`, chave `dailySeries` no DO). Somente leitura e só exibição: não entra em análise, proposta, aprovação nem conferência de ordem.
- "Todos os projetos" soma os 6 projetos dia a dia e refaz as razões a partir das somas: CPA = investimento ÷ vendas (todos os pedidos), ROAS = fat. líquido ÷ investimento, ROI = (lucro + investimento + taxas) ÷ (investimento + taxas), a mesma conta da Malva (conferida no Gabe). Projeto nunca lido deixa o total como N/D; falha de leitura mantém a anterior e marca atraso.
- `tracking_series` entrou na lista de leituras permitidas (`lib/cloud-malva.mjs` e a cópia da Edge Function). Edge Function `malva-mcp` publicada como v13 (só essa linha muda em relação à v12).
- Notch: aba "Dias" (tecla 7), depois de Sistema, para não mudar as teclas das abas existentes.
- Validação: `tests/daily-series.test.mjs`, suíte completa (1423), typecheck e build num worktree limpo do HEAD com só estas mudanças; self-test nativo.
- Havia, ao mesmo tempo, alterações de outra sessão no checkout (leitura `lean` em `worker/cloud-executor.ts`, `lib/persistence.mjs`, `lib/history-storage.mjs`, `lib/cloud-history-learning.mjs`). Ficaram fora deste commit, intactas; com elas, `tests/shared-view-readonly.test.mjs` falha (conta 3 `this.read()` e espera 6).

## Notch: resultado por dia dentro do detalhe da campanha (registro escrito às 2026-11-10 15:03:29 UTC por `date -u`)

- **Envio da aba Dias:** os commits `fed4c83` e `776f738` chegaram a `origin/main` junto com o push da sessão de memória do executor (fast-forward), antes da autorização do dono para o meu push, que as permissões tinham bloqueado. O dono decidiu depois, nesta sessão, "Manter e conferir". Versão Cloudflare `596c742c` (14:00:40 UTC), `/health` 200, chamadas à `malva-mcp` todas 200.
- **Aba Dias vazia (corrigido, `611161c`):** o decodificador tolerante do resumo (`SummaryLossy.swift`) tem lista fixa de seções e não incluía `days`; o app descartava o bloco. O self-test agora decodifica o resumo completo com `days`.
- **Pedido real do dono:** a tabela por dia dentro do detalhe de cada campanha, igual à do web. Commit `7206742`:
  - Rota `GET /api/companion/daily?projectId&adAccountId&objectId`, aceita a sessão do dono ou a credencial de leitura do app do Mac (fronteira em `lib/cloudflare-auth.mjs`, só GET). Usa o mesmo caminho do web (`updateDailyState` com `request`): pode renovar apenas o cache visual `daily:` daquela campanha, no máximo uma vez por minuto; não toca a central, análise, proposta nem ordem.
  - Notch: seção "Resultado por dia" no detalhe da campanha (`CampaignDaysView`), com a mesma tabela da aba Dias (`DayTable`). Consulta ao abrir o detalhe e repete até 3 vezes enquanto a leitura está pendente.
- **Validação:** suíte completa (1427), typecheck, build, self-test nativo. Em produção, depois das publicações de 14:54:49 e 14:57:06 UTC: `/health` 200; a rota responde 401 "Credencial do app não autorizada" com credencial errada, 401 sem credencial e 401 em POST.
- **Conferido pelo dono** (registro escrito às 2026-11-10 17:05:56 UTC por `date -u`): perguntado se a tabela por dia aparece ao abrir uma campanha no notch, respondeu "Sim, aparece". A conferência foi feita por ele na tela; daqui não há acesso à credencial do app (Chaves) nem à tela. Sem pendências deste item.
