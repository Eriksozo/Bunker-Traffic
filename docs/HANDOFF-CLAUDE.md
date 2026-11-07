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
