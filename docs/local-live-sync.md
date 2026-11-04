# Sincronização local Malva → Bunker

O processo `scripts/local-live-sync.mjs` consulta a origem Malva e mantém o cache de exibição do Bunker atualizado. Usa o protocolo oficial do app-server do Codex, sem iniciar turnos, invocar modelo ou copiar credenciais. A coleta é independente da cadência de análise configurada no painel.

## Limites da função

- Consulta somente identidade, projetos, campanhas e, quando necessário para completar o resultado, contas do Malva.
- Escreve exclusivamente pelo MCP `bunker_otimiza_o_de_campanhas.bunker_dados_atuais`, nas ações `import` e `failure`.
- Não muda orçamento, status, lance, público, criativo, campanha ou automação. Não aprova propostas.
- Não altera as leituras seladas das revisões: o backend salva o cache em registros `live:<projectId>` separados.
- Não cria análises ou propostas. O executor horário e a cadência personalizada continuam intactos.

## Requisitos

1. Mac ligado, usuário conectado e acesso à rede.
2. Node 22.13 ou superior e CLI Codex com `mcpServer/tool/call`, `mcpServerStatus/list` e threads efêmeras. A implementação foi conferida com Node 24.18.0 e `codex-cli 0.150.1` deste Mac.
3. Malva configurado no CLI com OAuth válido e o MCP privado Bunker disponível em `codex_apps`. A autenticação é administrada pelo próprio CLI.
4. Backend publicado com a ferramenta `bunker_dados_atuais` ou o contrato de compatibilidade `live-data` descrito abaixo. O serviço exige que o `siteProjectId` lido corresponda ao parâmetro `--site-id`.
5. Projetos e fusos já confirmados nas leituras Malva do Bunker. Um fuso ainda não confirmado é recusado pelo backend.

Não se deve colar tokens no código, no plist, em arquivos de dados ou em variáveis de ambiente do instalador. Não há fallback que extraia a autenticação da conversa ou do navegador. Reinicie/reconecte as integrações pelo fluxo nativo quando necessário.

Foi validada uma sessão app-server iniciada com ambiente limpo, contendo apenas `HOME`, `PATH`, `USER`, `LOGNAME`, `TMPDIR`, `LANG` e `LC_ALL`. Nela, chamadas reais de identidade/projetos do Malva e leitura do Bunker funcionaram sem variáveis voláteis da conversa. Isso não substitui a verificação após reiniciar o Mac ou renovar uma conexão.

## Comandos neste Mac

Execute a partir da pasta do site:

```sh
cd '/caminho/Bunker-Traffic'
```

Verificação somente de leitura, após publicar o backend:

```sh
node scripts/local-live-sync.mjs \
  --workspace-id 'SEU_WORKSPACE_UUID' \
  --site-id 'SEU_SITE_ID' \
  --codex-bin codex \
  --check
```

`--check` valida ferramentas conectadas, identidade do site, identidade do espaço e projetos configurados. Não consulta campanhas nem grava cache. Se o painel estiver pausado, verifica somente o Bunker e informa `sourceChecked:false`.

Primeira coleta e gravação do cache, para conferir antes de instalar o serviço:

```sh
node scripts/local-live-sync.mjs \
  --workspace-id 'SEU_WORKSPACE_UUID' \
  --site-id 'SEU_SITE_ID' \
  --codex-bin codex \
  --once
```

Sem `--check` ou `--once`, o mesmo comando mantém um processo com ciclos com início previsto a cada 60 segundos, sem sobreposição. O tempo gasto na coleta é descontado da espera; se ela ultrapassar um minuto, o ciclo seguinte aguarda a conclusão. Falhas de conexão aumentam o intervalo de reinício de 60 segundos até cinco minutos. Uma falha de projeto preserva a leitura anterior e permite atualizar os demais projetos.

O arquivo PID/nonce em `TMPDIR` impede duas instâncias locais. `--lock-file /caminho/arquivo` permite escolher o caminho, sem alterar configuração global. Não execute `--once` em paralelo ao serviço; pare o serviço primeiro. Não remova um lock cujo PID ainda esteja ativo.

## Serviço launchd

Depois de publicar, passar em `--check`, confirmar a primeira coleta e conferir o painel:

```sh
node scripts/install-local-live-sync.mjs install \
  --workspace-id 'SEU_WORKSPACE_UUID' \
  --site-id 'SEU_SITE_ID'
node scripts/install-local-live-sync.mjs status
```

O instalador administra somente `com.eriksozo.bunker-live-sync`. Não altera o heartbeat de análise, a agenda personalizada nem tarefas da nuvem.

Para interromper o sincronizador:

```sh
node scripts/install-local-live-sync.mjs stop
```

O plist fica em `~/Library/LaunchAgents/com.eriksozo.bunker-live-sync.plist`. Os logs de metadados ficam em `~/Library/Logs/Bunker/`. A pausa global do painel também bloqueia as coletas e escritas do relay: ele continua consultando apenas o estado do Bunker para detectar uma retomada.

## Contrato da coleta

O processo confere `workspace_whoami` antes de consultar os projetos e exige o ID de espaço informado. Os projetos vêm de `tracking_list_projects`, conciliados por ID e nome com o Bunker. Não reutiliza um cliente como substituto de outro.

Cada consulta de campanhas envia explicitamente:

```json
{
  "projectId": "ID confirmado na listagem",
  "level": "campaign",
  "sales": "traffic",
  "provider": ["meta"],
  "status": "spent",
  "accountStatus": "all",
  "preset": "custom",
  "from": "dia atual no fuso do projeto",
  "to": "mesmo dia, inclusivo",
  "limit": 100
}
```

As datas `from/to` do snapshot são instantes UTC explícitos, da meia-noite local à próxima meia-noite. A resposta precisa confirmar período, fuso, moeda e escopo de tráfego. Cada linha precisa pertencer ao projeto, ser campanha Meta e, em uma partição, à conta solicitada.

O formato real do Malva verificado nesta entrega tem `freshAt`, `period.{timezone,from,to,days}`, `salesScope.kind`, `rows`, `lastSyncAt` e, quando há corte, `truncated:{shown,total}`. A rotina usa a contagem retornada pela origem; não depende de um número fixo de campanhas.

- `fetchedAt` mantém o `freshAt` da consulta. `lastSyncAt` mantém o instante informado pela origem ou `null`. Um relógio nunca substitui o outro.
- Valores numéricos são copiados como vieram, incluindo orçamento e moeda próprios. Não converte orçamento, não transforma ausência em zero nem usa pedidos totais como vendas front.
- Uma resposta vazia válida pode gerar zero linhas. Uma falha nunca é convertida em uma resposta vazia.
- Uma campanha é identificada pelo par conta + `externalId`. Duplicatas dentro da mesma resposta são recusadas. Quando ela aparece em consultas completas diferentes, mudanças apenas nas métricas usam a linha inteira da consulta com `freshAt` mais recente, sem somar nem misturar campos.
- Divergências de orçamento, status ou outros metadados, e métricas divergentes com o mesmo relógio, geram `SOURCE_CHANGED`. A coleta inteira pode ser repetida uma única vez, somente em leitura, compartilhando o limite de 500 consultas. Se o cenário continuar mudando, o cache anterior fica preservado até outro ciclo. Isso não autoriza repetir importações ambíguas nem ações em campanhas.
- Quando há mais de 100 linhas, lista as contas Meta do projeto e divide os filtros `accountIds` em grupos disjuntos, subdividindo grupos truncados. Confere o total e a presença das campanhas da consulta inicial.
- Se uma única conta ainda exceder 100 campanhas, a ferramenta atual não oferece paginação suficiente: registra `SOURCE_INCOMPLETE` e preserva o cache. Não inventa filtros para ocultar a linha 101.
- Mudanças de contagem durante a coleta, virada do dia, leitura com mais de cinco minutos, mais de 3.000 linhas ou mais de 1.450.000 bytes recusam o lote, sem descartar linhas.

## Gravação e confirmação

O catálogo de ferramentas do conector pode permanecer na versão anterior após a publicação. O relay prefere a ferramenta nova quando ela aparece. Se somente a ferramenta antiga `bunker_otimiza_o_de_campanhas.bunker_atualizar_rodada` estiver disponível, usa exclusivamente o envelope fixo `{id:'live-data',status:'Pendente',revision:0,note:JSON.stringify(input)}` no mesmo MCP privado e na mesma autenticação administrada pelo CLI. O backend precisa estar publicado com esse contrato antes de executar o relay. Esse envelope é desviado para o cache separado; `revision:0` não é uma revisão da central e não altera rodadas. O CAS continua sendo o `expectedRevision` do cache dentro de `input`.

O relay não aceita outros IDs ou ações da ferramenta antiga. Seu chamador continua limitado às ações `read`, `import` e `failure`; nenhuma atualização de rodada ou aprovação fica disponível por essa compatibilidade.

Antes de cada escrita, o processo relê o Bunker, confere a pausa, o projeto e a revisão do cache. Envia `expectedRevision` tanto em importações como no registro de falhas. Uma revisão alterada durante a coleta não é sobrescrita.

Após uma resposta de importação, relê o cache novamente. Só registra `project_synced` quando a leitura persistida tem revisão igual ou superior à retornada e o mesmo snapshot normalizado, incluindo nomes, IDs, métricas e `fetchedAt`.

Timeout, resposta ambígua ou divergência nessa conferência gera `cache_write_unconfirmed`. O processo não reenvia a mesma importação nem grava uma falha por cima dela. O próximo ciclo começa por uma nova leitura.

Os logs contêm apenas evento, horário, ID de projeto, contagem de linhas, revisões e relógios da coleta. Erros têm códigos/mensagens fixos; respostas brutas, URLs, credenciais e mensagens remotas não são registradas. Diagnósticos nativos do app-server não são encaminhados aos logs.

## Testes

```sh
node --test tests/local-live-sync.test.mjs
```

Cobertura: fuso e horário de verão, preservação de métricas, resposta vazia legítima, rejeição de erros, identidade, fonte conectada versus catálogo em inicialização, partição acima de 100 linhas, cobertura divergente, conta sem paginação, pausa, concorrência, isolamento de falhas, confirmação persistida, importação ambígua sem reenvio e instância única.

Referências oficiais: [app-server](https://learn.chatgpt.com/docs/app-server) e [allowlists MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli). A allowlist do Malva é aplicada somente ao processo app-server deste relay; o código também permite apenas a ferramenta Bunker indicada e suas três ações. Nenhum arquivo global de configuração é alterado.
