# Executor Cloudflare

O Durable Object BunkerCloudExecutor coordena a fila e mantém ativação, pausa e atividade persistentes. O cron verifica a fila a cada minuto; o alarme avança unidades limitadas de trabalho. A dashboard pode ficar fechada. A tarefa Codex local permanece pausada e não é requisito da nuvem.

## Ativar e controlar

Na dashboard, em Revisões → Executor na nuvem, conferir a conexão e ativar. A conferência valida identidade/alcance Malva e faz uma chamada real ao Workers AI. Requer `MALVA_MCP` nos Secrets do Supabase Bunker Traffic. A validade da conferência para ativar é cinco minutos. Falha mantém o processamento sem confirmação.

A agenda existente controla admissão de análises: intervalo, dias, início/fim, fuso e pausa são preservados. O executor prioriza verificações de envio e aprovações exatas, depois perguntas/discussões/revisões/perspectivas e novas coletas. Pausar bloqueia novas unidades, pré-conferência e despacho; um pedido já iniciado no provedor ainda precisa ser conferido, nunca reenviado.

## Dados e agentes

A conexão pessoal MCP é de servidor, sem cookies/tokens do desktop. A Edge Function exige a credencial de serviço do backend. Chaves e dados de clientes não entram no Git ou frontend. Workers AI Llama 3.3 70B recebe contexto mínimo por cliente; fontes/nomes são dados não confiáveis.

Cada coleta confirma 12 fontes: campanha/conjunto/anúncio em 7 e 3 dias completos, ontem e hoje parcial. Hoje acompanha campanhas ativas, com gasto e já acompanhadas, com cobertura explícita; arquivo antigo inativo fica fora desse recorte. Truncamentos são particionados por contas e pais reais; insuficiência de cobertura falha preservando a fonte anterior. Fontes não se somam entre níveis ou janelas. Hoje parcial não equivale a um dia encerrado. Gasto/receita em reais e orçamento nativo são distintos.

Cada unidade prioriza até seis campanhas para histórico e detalhe diário. O pacote do modelo pode reduzir essa amostra e os filhos exibidos para caber no limite: quantidades omitidas e campanhas adiadas são declaradas. A cobertura é declarada: coleta completa não significa parecer individual de toda campanha. Tráfego, criativos, orçamento e gestão fazem chamadas separadas ao modelo, com perguntas materiais e revisão vinculada. Sugestões de campanha são o escopo financeiro atual deste executor; hierarquia é lida para avaliar os filhos. Sem evidência, investigar/manter.

O cache visual consulta até dois projetos por ciclo e preserva timestamps reais. É consulta periódica, não streaming nem garantia de atraso zero da Meta/Malva. Erros por projeto ficam visíveis sem transformar ausência em zero. Órbita ainda não tem credencial própria neste executor: aliases/contexto importados conservam data, sem alegar consulta atual independente.

## Aprovação e envio

Somente a interface autenticada do proprietário aprova versão, assinatura, projeto, conta, objeto, moeda e valores exatos. Parecer do modelo, botão genérico ou alteração de cadência não autoriza dinheiro. Limites/metas ausentes continuam N/D; não herdar metas de outro cliente.

Fluxo: claim → leitura real → prepare → submit persistido → somente a primeira resposta dispatchGranted:true permite um despacho do comando exato → releitura → confirm. A Edge Function revalida a proposta e consome atomicamente um recibo por execução antes do provedor. Timeout/resposta perdida não permite reenvio; somente conferência e histórico. Não cria campanhas, altera lance/público/criativo nem envia mensagens externas.

## Infraestrutura

Cloudflare: AI binding, BUNKER_EXECUTOR Durable Object SQLite, cron * * * * *. Supabase: bunker_records/bunker_reports e Edge Function malva-mcp. Sites privado é interface de compatibilidade que chama o mesmo executor pelo gateway autenticado; não constitui um segundo executor. APIs de ativação/pausa são do dono, nunca expostas ao agente MCP.

Os testes incluem despacho único, resposta perdida, timeout, falsificação de moeda/versão/valor, allowlist, saída inválida do modelo, central pausada e cobertura/truncamento. Desenvolvimento usa dados fictícios. Nenhuma ação real de orçamento/status é disparada como teste.

O status do executor usa a última leitura de controle em memória, com controlReadAt explícito; não reabre toda a central a cada consulta visual. As decisões continuam relendo o estado persistido. A consulta de recibos arquivados filtra projeto/proposta antes de expandir execuções e decodifica cada arquivo uma vez.

Os arquivos de cards usam índices parciais por projeto e cursor. A leitura exclui o registro central antes de decodificar JSON e reutiliza cada documento. Em 04/11, o mesmo teste de leitura passou de aproximadamente 6,7 s para 110 ms; é uma medição pontual, não um SLA. Doze cenários compararam a saída antiga e nova (projeto existente/ausente, operações, limites e cursor) com equivalência exata. As permissões continuam restritas ao servidor.

Quando o contexto do modelo excede o limite, cópias de auditoria dos aprendizados, histórico antigo dos incidentes e campos duplicados raw/echo dos eventos são omitidos apenas do pacote enviado ao modelo, com contagens explícitas. A observação atual, fontes, casos, condições do incidente, timestamps e valores das edições permanecem. Os originais armazenados não são alterados. A amostra de campanhas pode ser reduzida e declarada; isso nunca equivale a analisar individualmente toda a conta.

A análise operacional usa analysisScope=meta-operating-cohort: 7d/3d/ontem incluem todo o gasto do recorte Meta; hoje inclui todas as campanhas ativas, com gasto, já acompanhadas e identificadas nas janelas fechadas. Os filhos ativos são recortados aos pais ativos; os filhos com gasto são lidos para todos os pais desse escopo. Arquivo antigo inativo fora desse universo não é declarado como auditado. Importar essa análise exige as 12 leituras independentes. coverage=active-spent-tracked continua exclusivo do cache visual e continua sendo recusado como fonte analítica. Aprovação, moedas, limites e janela de execução não mudam.
