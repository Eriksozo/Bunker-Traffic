# Leitura direta Malva no Supabase

O secret `MALVA_API`, já cadastrado pelo proprietário no projeto Supabase Bunker Traffic, é lido apenas pela função `malva-read`. Não exporte a chave para o Mac, Cloudflare, navegador, logs ou GitHub.

## Caminho e uso

Cloudflare / MCP privado → backend autenticado → Supabase Edge Function → API oficial Malva. O gateway usa a credencial de serviço já existente e a função exige tanto JWT válido quanto igualdade com o service_role. Não aceita JWT comum, origens arbitrárias, URL enviada pelo cliente ou método de escrita. Só permite GETs predeterminados no provedor.

A ferramenta existente `bunker_atualizar_rodada` aceita `id: source-data`, `status: Pendente`, `revision: 0` e `note` JSON. Esse envelope é somente leitura; não escreve rodadas ou campanhas. O briefing `bunker_ler` publica os pedidos em `plan.sourceReads`.

Primeiro: `{"section":"projects"}`. A chave oficial pode alcançar apenas um projeto. Não inferir acesso a outros projetos. Os demais permanecem no MCP Malva; Órbita segue no próprio conector.

Depois: `{"section":"campaigns","projectId":"UUID_REAL_CONFIGURADO","level":"campaign","period":"four"}`. Há também `adset`, `ad`, `accountId`, filtros de pai `campaignId`/`adsetId` e `objectId` para anúncio, status e período customizado. `ad-detail` exige o UUID interno da linha (`id`); `ad-changes` exige o ID na plataforma (`externalId`). `ad-accounts`, `ad-detail` e `ad-changes` atendem investigação de hierarquia e últimas edições. O backend confere ID e nome configurados antes de devolver uma leitura do projeto.

A interface autenticada dispõe do mesmo contrato em `POST /api/malva`. A API não grava a decisão, não atualiza uma análise selada e não autoriza execução. Preserve a pausa da central e as reservas/cadência das revisões. O envio financeiro continua exclusivamente pelo fluxo exato aprovado e MCP Malva, com conferência independente.

## Rapidez e relógios

- Quatro períodos num pedido do agente, consultados em paralelo: 7 dias completos, 3 dias completos, ontem e hoje parcial, no fuso do projeto. Não usar o preset 3d/7d do provedor, pois inclui o dia parcial.
- Pedidos idênticos em voo compartilham a leitura no mesmo isolate. Cache de resposta de até 2 segundos; descoberta de projetos até 30 segundos. Não promete cache global entre isolates.
- Até 240 chamadas/minuto/isolate como proteção local; o limite oficial da chave continua soberano. 429 retorna erro, sem tempestade de retry. A integração não força releitura da Meta.
- `readAt`: conclusão da consulta; `sourceFreshAt`: cabeçalho de atualização do relatório, quando presente; `lastSyncAt`: sincronização da origem, como veio. Ausência permanece null. Resposta `sourceCache: stale` é identificada e não entra no cache curto. Não pode sustentar uma decisão nova.
- Projeção elimina campos extras dos anúncios e mantém métricas, dinheiro nativo, IDs e totais. Não soma fases, níveis ou períodos; não converte moeda; não deduz front dos pedidos.
- Limites excedidos, identidade divergente e falhas de rede não viram listas vazias nem sucesso. Não substituem a última fonte válida. Não há importação automática ou execução de análise nesta integração.

## Operação

A função está em `supabase/functions/malva-read`; a cópia do adaptador é verificada por teste de igualdade. Publique ambas as dependências com verify_jwt ativado. O Bunker não precisa de outra migração de banco. A chave continua revogável na Malva e substituível no secret do Supabase. A nova chave só entra em isolates novos/republicados.

Contrato oficial: https://malvadash.com/docs/api e https://malvadash.com/api/v1/openapi.json . Segredos no Supabase: https://supabase.com/docs/guides/functions/secrets .

## Validação de implantação em 04/11/2026

Cloudflare e o MCP privado foram publicados; a chamada autenticada percorreu o gateway e a função. A Malva recusou a credencial original. Após normalizar espaços/prefixos de cabeçalho, a função confirmou `MALVA_KEY_FORMAT_INVALID`: o secret existe, mas não contém uma chave oficial `mvk_…`. É necessário o proprietário corrigir o secret. Não foi possível medir latência de relatório nem alcance de projetos; o MCP continua como alternativa. A automação local permaneceu PAUSED. Esse registro descreve a verificação desta implantação, não um estado permanente da conexão.
