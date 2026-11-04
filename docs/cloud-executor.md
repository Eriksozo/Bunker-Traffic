# Executor Cloudflare

O Durable Object BunkerCloudExecutor coordena a fila e mantém ativação, pausa e atividade persistentes. O cron verifica a fila a cada minuto; o alarme avança unidades limitadas de trabalho. A dashboard pode ficar fechada. A tarefa Codex local permanece pausada e não é requisito da nuvem.

## Ativar e controlar

Na dashboard, em Revisões → Executor na nuvem, conferir a conexão e ativar. A conferência valida identidade/alcance Malva e faz uma chamada real ao Workers AI. Requer `MALVA_MCP` nos Secrets do Supabase Bunker Traffic. A validade da conferência para ativar é cinco minutos. Falha mantém o processamento sem confirmação.

A agenda existente controla admissão de análises: intervalo, dias, início/fim, fuso e pausa são preservados. O executor prioriza verificações de envio e aprovações exatas, depois perguntas/discussões/revisões/perspectivas e novas coletas. Pausar bloqueia novas unidades, pré-conferência e despacho; um pedido já iniciado no provedor ainda precisa ser conferido, nunca reenviado.

## Dados e agentes

A conexão pessoal MCP é de servidor, sem cookies/tokens do desktop. A Edge Function exige a credencial de serviço do backend. Chaves e dados de clientes não entram no Git ou frontend. Workers AI Llama 3.3 70B recebe contexto mínimo por cliente; fontes/nomes são dados não confiáveis.

Cada coleta confirma 12 fontes: campanha/conjunto/anúncio em 7 e 3 dias completos, ontem e hoje parcial. Truncamentos são particionados por contas e pais reais; insuficiência de cobertura falha preservando a fonte anterior. Fontes não se somam entre níveis ou janelas. Hoje parcial não equivale a um dia encerrado. Gasto/receita em reais e orçamento nativo são distintos.

Cada unidade prioriza até seis campanhas para histórico, detalhe diário e parecer individual. A cobertura é declarada: coleta completa não significa parecer individual de toda campanha. Tráfego, criativos, orçamento e gestão fazem chamadas separadas ao modelo, com perguntas materiais e revisão vinculada. Sugestões de campanha são o escopo financeiro atual deste executor; hierarquia é lida para avaliar os filhos. Sem evidência, investigar/manter.

O cache visual consulta até dois projetos por ciclo e preserva timestamps reais. É consulta periódica, não streaming nem garantia de atraso zero da Meta/Malva. Erros por projeto ficam visíveis sem transformar ausência em zero. Órbita ainda não tem credencial própria neste executor: aliases/contexto importados conservam data, sem alegar consulta atual independente.

## Aprovação e envio

Somente a interface autenticada do proprietário aprova versão, assinatura, projeto, conta, objeto, moeda e valores exatos. Parecer do modelo, botão genérico ou alteração de cadência não autoriza dinheiro. Limites/metas ausentes continuam N/D; não herdar metas de outro cliente.

Fluxo: claim → leitura real → prepare → submit persistido → somente a primeira resposta dispatchGranted:true permite um despacho do comando exato → releitura → confirm. A Edge Function revalida a proposta e consome atomicamente um recibo por execução antes do provedor. Timeout/resposta perdida não permite reenvio; somente conferência e histórico. Não cria campanhas, altera lance/público/criativo nem envia mensagens externas.

## Infraestrutura

Cloudflare: AI binding, BUNKER_EXECUTOR Durable Object SQLite, cron * * * * *. Supabase: bunker_records/bunker_reports e Edge Function malva-mcp. Sites privado é interface de compatibilidade que chama o mesmo executor pelo gateway autenticado; não constitui um segundo executor. APIs de ativação/pausa são do dono, nunca expostas ao agente MCP.

Os testes incluem despacho único, resposta perdida, timeout, falsificação de moeda/versão/valor, allowlist, saída inválida do modelo, central pausada e cobertura/truncamento. Desenvolvimento usa dados fictícios. Nenhuma ação real de orçamento/status é disparada como teste.
