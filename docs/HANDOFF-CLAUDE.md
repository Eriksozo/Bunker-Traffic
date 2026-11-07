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
