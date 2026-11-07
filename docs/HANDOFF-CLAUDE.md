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

MCP privado do Bunker: `https://bunker-trafego-erik.eriksozo.chatgpt.site/mcp`. Ler `bunker_ler` no início para obter revisão, runbook e fila reais. Processar primeiro conferências e execuções aprovadas, depois a fila autônoma e coletas elegíveis. Não iniciar reserva ou coleta fora da agenda. Não criar uma segunda rotina para competir com a Cloudflare.

## O que acabou de mudar

- `8235b97`: fontes compactadas volumosas passam para registros imutáveis por SHA-256, no mesmo commit transacional/CAS da central. Falta/corrupção falha explicitamente, sem fabricar fontes vazias. Formatos antigos continuam legíveis. O teto por registro não foi removido.
- A visão geral distingue base antiga de classificação vazia: `—` indica classificação indisponível. Acompanhamento visual recente não renova os quatro períodos da análise. Há atalho para revisões e contagem explícita de campanhas aguardando revisão.
- `92bb0b4`: invalidação de fonte permanece definitiva. Uma coleta sucessora que falha não ressuscita uma triagem dispensada nem uma autorização anterior.
- Na verificação dessa entrega, as 72 fontes foram preservadas e a central passou de aproximadamente 1,75 MB a 0,91 MB. Não reutilizar esses números como medição atual. A conferência visual de layout não foi concluída naquela entrega.

## Conexões: configurar não significa autenticar

A conta Claude selecionada pelo proprietário foi autorizada para este repasse. A configuração de servidores do projeto fica em `.mcp.json`, sem chaves. Os conectores do Codex não são automaticamente compartilhados com outro cliente.

| Serviço | Caminho de acesso | Como confirmar |
| --- | --- | --- |
| Bunker | MCP privado acima; OAuth próprio do cliente | `bunker_ler` deve retornar revisão, fonte e plano atuais; não basta aparecer na lista. |
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
