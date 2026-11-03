# Atualização dos dados

## Acompanhamento atual

O executor local consulta, sem modelo, os MCPs já autenticados no Codex deste Mac. Usa a API documentada `mcpServer/tool/call` do app-server; nenhuma credencial OAuth é extraída ou copiada. As únicas chamadas Malva permitidas são identidade, projetos, contas e campanhas. A única escrita é no cache visual do próprio Bunker.

Cada ciclo coleta todas as campanhas Meta com gasto hoje dos projetos configurados, no fuso de cada projeto e com vendas atribuídas ao tráfego. O ciclo seguinte é iniciado após completar 60 segundos desde o início do anterior. Uma coleta mais lenta precisa terminar antes do próximo ciclo, sem sobreposição. Leituras truncadas são particionadas por conta; dados incompletos nunca substituem a última leitura válida. Uma coleta recente não prova uma sincronização recente da origem: o Malva ainda pode refletir atraso da Meta.

O site lê o cache privado a cada dez segundos enquanto está aberto e visível. A Visão geral, em Hoje, usa uma leitura atual completa e mais nova do mesmo projeto. Mostra separadamente `fetchedAt` da coleta e `lastSyncAt` da origem. Falhas preservam os números anteriores com estado desatualizado. Sem sucesso recente, o painel não alega que o Mac está online.

## Análises e decisões

O cache usa registros D1 `live:<projectId>`, com revisão própria e compare-and-swap. Nunca substitui `state.snapshots`, fontes congeladas, selos de aprovação, escolhas ou histórico. As quatro janelas e a hierarquia continuam na cadência personalizada de revisão. Cards e relatórios usam a base da análise, identificada na interface; dados de acompanhamento não aprovam nem executam ajustes.

A pausa do Bunker impede novas coletas e gravações. Identidade do workspace, identidade do Site, projeto, nome, fuso, período, duplicidades, frescor e limites são conferidos. O executor relê a pausa e a revisão antes de importar e confere a gravação depois. Uma resposta ambígua nunca autoriza reenvio automático.

## Executor e operação

Ver [local-live-sync.md](local-live-sync.md) para execução, instalação e diagnóstico do serviço local. O executor funciona com o Mac acordado, rede e conexão do Codex disponíveis; não existe sincronização em segundo plano na nuvem nesta implementação. O heartbeat existente de análises permanece separado e não tem sua agenda alterada pelo sincronizador.

A conexão de visitante do Sites não foi declarada: a descoberta de elegibilidade estava indisponível. Este caminho usa acesso nativo local à fonte e escrita autenticada independente via MCP do Bunker, conforme a preferência do usuário pelo executor no Mac; não é um proxy de credenciais do visitante.

## Verificações

- Testes SQLite verificam que fontes, decisões, selos e revisão central permanecem byte a byte iguais após sincronizações.
- Testes de leitura cobrem concorrência, períodos, virada do dia, duplicidades, falhas e pausa.
- Na prévia local, indicadores mudaram automaticamente de R$777,77 para R$888,88 e R$999,99 com dados sintéticos. O rascunho 1234 do teto diário permaneceu em edição sem ser salvo; a revisão central continuou 92. Console sem erros no fluxo exercitado.
- A primeira coleta real foi confirmada em produção nos seis projetos configurados, com releitura idêntica dos dados persistidos: Gabe, John, Leandro, Murilo, Nico e Ronald. A página publicada passou a exibir a coleta atual sem recarga manual. Isso não equivale a teste após reiniciar o Mac.
