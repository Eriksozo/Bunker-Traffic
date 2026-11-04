# Bunker · Central de tráfego

Central privada para análise de campanhas, decisões, colaboração de agentes e aprendizado com evidências. Interface React/Vinext em Cloudflare Workers; armazenamento Supabase Postgres; Malva e Órbita consultados pelo executor local.

O seletor **Todos os projetos** reúne indicadores, campanhas e cards em uma visão consolidada, com identificação do projeto para cada decisão. Os totais comparam somente janelas equivalentes e sinalizam cobertura parcial. Campanhas compartilhadas contam mídia e orçamento uma vez; receita com mais de uma atribuição sem conciliação fica N/D. Metas, incidentes, pedidos de revisão e autorizações financeiras continuam vinculados a um projeto real.

## Operação

- Compara sete e três dias completos, ontem e hoje parcial, com fonte, fuso e atualização separados.
- Organiza campanhas e sugestões em kanban, com diário de resultados, histórico de escolhas e reavaliação quando o cenário muda.
- Registra pareceres reais de tráfego, criativos, orçamento e gestão. Não simula presença ou conversas.
- Mantém cadência personalizada, dias, horários, pausa e proteção contra rodadas simultâneas.
- Separa front, pedidos e upsells; metas e limites pertencem a cada projeto. Ausência de dado permanece N/D.
- Preserva relatórios, arquivos de colaboração, sugestões e recibos de execução com revisão otimista e transações atômicas.

## Aprovação e execução

Sugestão, escolha, proposta aprovada e aplicação confirmada são estados diferentes. Somente o dono pode aprovar a versão exata de uma proposta na interface. O executor local aplica apenas orçamento diário/status Meta autorizados, passando por claim, pré-conferência, despacho único e readback. Envio, timeout ou parecer de agente não comprovam aplicação.

O Mac deve permanecer ligado, conectado e com suas integrações disponíveis. A agenda salva não comprova execução. O cache visual pode atualizar independentemente das fontes congeladas das análises; uma leitura recente não autoriza reutilizar uma aprovação antiga.

## Serviços

A interface principal fica em [bunker-traffic.erik-iplou.workers.dev](https://bunker-traffic.erik-iplou.workers.dev). O login é Supabase Auth, restrito ao proprietário configurado no backend. O MCP privado existente no Sites funciona como compatibilidade autenticada e acessa a mesma base pelo gateway privado da Cloudflare.

O GitHub armazena código, migrations, testes e documentação. Os dados operacionais e as credenciais não fazem parte do repositório. A publicação no GitHub não equivale à implantação nem comprova coleta de anúncios.

Detalhes: [conexões e publicação](docs/connections.md), [contrato dos agentes](AGENT-RUNBOOK.md), [sincronizador local](docs/local-live-sync.md), [origem do código](docs/source-sync.md).

## Desenvolvimento

Requisitos: Node 22.13+ e npm. O executor local usa macOS e autenticação do CLI Codex. Para desenvolvimento e verificação:

```sh
npm ci
npm test
npm run typecheck
npm run build
```

O deploy usa `npx wrangler deploy --config dist/server/wrangler.json`, com segredos configurados previamente na Cloudflare. Aplique as migrations Supabase antes de código que dependa delas. O build externo não inclui o D1 fictício da origem nem confia em cabeçalhos de identidade enviados pelo visitante.

A camada de compatibilidade D1 permanece para recuperação da origem preservada. Depois do corte, essa origem não é um espelho e não deve ser restaurada sem conciliar gravações novas. Instruções e limites da migração estão em [docs/connections.md](docs/connections.md).

## Código e dados

A base inicial foi a versão46 do Bunker no Sites. As fixtures públicas usam identificadores fictícios. O escritório pixel art e o diorama3D usam arte original; licenças de fontes e componentes acompanham os arquivos. As fases e regras de aquisição continuam dependentes dos dados, do projeto e de validação humana; o classificador é uma triagem, não uma prova causal.
