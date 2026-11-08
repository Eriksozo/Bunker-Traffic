# Executor Cloudflare

O Durable Object BunkerCloudExecutor coordena a fila e mantém ativação, pausa e atividade persistentes. O cron verifica a fila a cada minuto; o alarme avança unidades limitadas de trabalho. A dashboard pode ficar fechada. A tarefa Codex local permanece pausada e não é requisito da nuvem.

## Ativar e controlar

Na dashboard, em Revisões → Executor na nuvem, conferir a conexão e ativar. A conferência valida identidade/alcance Malva e faz uma chamada real ao Workers AI. Requer `MALVA_MCP` nos Secrets do Supabase Bunker Traffic. A validade da conferência para ativar é cinco minutos. Falha mantém o processamento sem confirmação.

A agenda existente controla admissão de análises: intervalo, dias, início/fim, fuso e pausa são preservados. O executor prioriza verificações de envio e aprovações exatas, depois perguntas/discussões/revisões/perspectivas e novas coletas. Pausar bloqueia novas unidades, pré-conferência e despacho; um pedido já iniciado no provedor ainda precisa ser conferido, nunca reenviado.

## Dados e agentes

A conexão pessoal MCP é de servidor, sem cookies/tokens do desktop. A Edge Function exige a credencial de serviço do backend. Chaves e dados de clientes não entram no Git ou frontend. Workers AI Llama 3.3 70B recebe contexto mínimo por cliente; fontes/nomes são dados não confiáveis.

Cada coleta confirma 12 fontes: campanha/conjunto/anúncio em 7 e 3 dias completos, ontem e hoje parcial. Hoje acompanha campanhas ativas, com gasto e já acompanhadas, com cobertura explícita; arquivo antigo inativo fica fora desse recorte. Truncamentos são particionados por contas e pais reais; insuficiência de cobertura falha preservando a fonte anterior. Fontes não se somam entre níveis ou janelas. Hoje parcial não equivale a um dia encerrado. Gasto/receita em reais e orçamento nativo são distintos.

Cada unidade prioriza até seis campanhas para histórico e detalhe diário. O pacote do modelo pode reduzir essa amostra e os filhos exibidos para caber no limite: quantidades omitidas e campanhas adiadas são declaradas. A cobertura é declarada: coleta completa não significa parecer individual de toda campanha. Tráfego, criativos, orçamento e gestão fazem chamadas separadas ao modelo, com perguntas materiais e revisão vinculada. Sugestões de campanha são o escopo financeiro atual deste executor; hierarquia é lida para avaliar os filhos. Sem evidência, investigar/manter.

O cache visual consulta até dois projetos por ciclo e preserva timestamps reais. É consulta periódica, não streaming nem garantia de atraso zero da Meta/Malva. Erros por projeto ficam visíveis sem transformar ausência em zero. Órbita: `Orbita_token` alimenta a função `orbita-mcp` no Supabase. Etapas elegíveis atualizam o contexto editorial por projeto com intervalo mínimo de 60s, identidade conciliada e cobertura parcial explícita. Não há transições de produção nem alterações de anúncios por esse conector.

## Aprovação e envio

Somente a interface autenticada do proprietário aprova versão, assinatura, projeto, conta, objeto, moeda e valores exatos. Parecer do modelo, botão genérico ou alteração de cadência não autoriza dinheiro. Limites/metas ausentes continuam N/D; não herdar metas de outro cliente.

Fluxo: claim → leitura real → prepare → submit persistido → somente a primeira resposta dispatchGranted:true permite um despacho do comando exato → releitura → confirm. A Edge Function revalida a proposta e consome atomicamente um recibo por execução antes do provedor. Timeout/resposta perdida não permite reenvio; somente conferência e histórico. Não cria campanhas, altera lance/público/criativo nem envia mensagens externas.

## Infraestrutura

Cloudflare: AI binding, BUNKER_EXECUTOR Durable Object SQLite, cron * * * * *. Supabase: bunker_records/bunker_reports e Edge Function malva-mcp. Sites privado é interface de compatibilidade que chama o mesmo executor pelo gateway autenticado; não constitui um segundo executor. APIs de ativação/pausa são do dono, nunca expostas ao agente MCP.

Os testes incluem despacho único, resposta perdida, timeout, falsificação de moeda/versão/valor, allowlist, saída inválida do modelo, central pausada e cobertura/truncamento. Desenvolvimento usa dados fictícios. Nenhuma ação real de orçamento/status é disparada como teste.

O status do executor usa a última leitura de controle em memória, com controlReadAt explícito; não reabre toda a central a cada consulta visual. As decisões continuam relendo o estado persistido. A consulta de recibos arquivados filtra projeto/proposta antes de expandir execuções e decodifica cada arquivo uma vez.

Os arquivos de cards usam índices parciais por projeto e cursor. A leitura exclui o registro central antes de decodificar JSON e reutiliza cada documento. Em 04/11, o mesmo teste de leitura passou de aproximadamente 6,7 s para 110 ms; é uma medição pontual, não um SLA. Doze cenários compararam a saída antiga e nova (projeto existente/ausente, operações, limites e cursor) com equivalência exata. As permissões continuam restritas ao servidor.

Quando o contexto do modelo excede o limite, cópias de auditoria dos aprendizados, histórico antigo dos incidentes e campos duplicados raw/echo dos eventos são omitidos apenas do pacote enviado ao modelo, com contagens explícitas. A observação atual, fontes, casos, condições do incidente, timestamps e valores das edições permanecem. Os originais armazenados não são alterados. A amostra de campanhas pode ser reduzida e declarada; isso nunca equivale a analisar individualmente toda a conta.

O pacote tem teto de 40 KB para reservar espaço no limite de 24 mil tokens do modelo, incluindo instruções, esquema e resposta. Se necessário, aprendizados antigos são adiados com seus IDs declarados, preservando a observação mais recente e os dados atuais das campanhas. O registro da etapa informa quantas campanhas realmente entraram no contexto reduzido. Excesso remanescente falha sem sugestão nem alteração financeira.

## Refinamento das decisões e do contexto

Uma venda isolada não obriga manter um teste/Avatar deficitário. Pausa, redução e observação são alternativas condicionais: considerar entrega efetiva, aquisição rentável, hierarquia, checkout, proteção própria e fatos novos após a edição. O diagnóstico `weak-acquisition` destaca front baixo e retorno abaixo do equilíbrio nas três janelas observadas; não cria parecer, proposta ou autorização. Hoje parcial e janelas sobrepostas não comprovam sequência diária. Testes protegidos, contas restritas e fonte vencida mantêm prioridade sobre a triagem.

Os agentes recebem até cinco observações locais recentes, com a afirmação atual, revisão, status e até três referências/casos por entrada; contagens omitidas são explícitas. O pacote de edições mantém os cinco eventos recentes e a última ocorrência observada de orçamento, status e criativo na amostra recebida. Diários e valores das edições são preservados; fontes completas e journals existentes não são reescritos. Os pareceres anteriores entram pelo resumo quando disponível. Uma rejeição explícita do modelo por tamanho admite uma única nova geração com até 24 KB e novos enums de alvos; outras falhas não são repetidas. Esse retry é de inferência, jamais de orçamento/status ou envio financeiro. Cobertura e referências usam somente os alvos que o modelo realmente recebeu.

A pesquisa consulta detalhes de 14 dias para a série diária e detalhes de hoje, separadamente, para horas intradiárias. Identidade, moeda de métricas e fuso devem coincidir com campanha/projeto. O recorte pós-edição usa apenas horas inteiras de hoje cujo início ocorreu após a última edição observada e cujo fim antecede a consulta. Horas ausentes/duplicadas, moeda desconhecida, agregados de vários dias ou ausência de edição resultam em N/D. Pedidos horários não viram vendas front. O card mostra essa leitura dentro dos detalhes do contexto somente quando ela pertence à mesma rodada; não representa baseline completo, causalidade ou gatilho de execução.

Falhas de leitura MCP registram somente ferramenta, código/status seguros, categoria do erro, campos de entrada conhecidos e contagens/tamanho dos filtros. Não registram valores, nomes, IDs de clientes, respostas completas, argumentos financeiros ou credenciais. Erros estruturados e erros textuais permanecem falhas; jamais viram uma leitura vazia bem-sucedida. Os logs de leitura não criam retentativa de comandos financeiros.

Filtros de pais são divididos antes do pedido em lotes de até 25 campanhas. Um lote truncado é refinado novamente; contagens, identidade dos pais e presença das linhas inicialmente retornadas são conferidas. Partições divergentes ou incompletas preservam a fonte anterior. Tráfego, criativos, orçamento e gestão recebem tarefas distintas de verificação; a síntese não deve tratar quatro textos genéricos concordantes como sustentação suficiente. Revisão do agente continua diferente de aprovação do dono.

A análise operacional usa analysisScope=meta-operating-cohort: 7d/3d/ontem incluem todo o gasto do recorte Meta; hoje inclui todas as campanhas ativas, com gasto, já acompanhadas e identificadas nas janelas fechadas. Os filhos ativos são recortados aos pais ativos; os filhos com gasto são lidos para todos os pais desse escopo. Arquivo antigo inativo fora desse universo não é declarado como auditado. Importar essa análise exige as 12 leituras independentes. coverage=active-spent-tracked continua exclusivo do cache visual e continua sendo recusado como fonte analítica. Aprovação, moedas, limites e janela de execução não mudam.


## Recuperação limitada do transporte Malva MCP

O bridge da nuvem pode repetir uma única vez apenas as ferramentas da lista de leitura, com os mesmos argumentos. A política aceita falhas de rede/timeout ou HTTP 408, 429, 500, 502, 503 e 504; acesso negado, validação, limites de entrada, JSON inválido e falhas de protocolo não são repetidos. O status HTTP da origem fica explícito, separado do HTTP 502 do bridge. Não converte qualquer erro 4xx em indisponibilidade transitória.

Cada tentativa mantém o limite de 20 segundos; o orçamento total das leituras é 26 segundos, abaixo do transporte Supabase de 30 segundos. A segunda tentativa usa apenas o tempo restante. O intervalo padrão é 500 ms; `Retry-After` em segundos ou data é respeitado. Se exigir mais de 5 segundos de espera ou não couber no orçamento, a leitura falha explicitamente, preservando o intervalo no diagnóstico; nenhuma nova agenda ou reserva é criada.

Uma recuperação registra `mcp_read_recovered` nos logs do bridge, sem credenciais, corpo da resposta ou argumentos das campanhas. Falhas definitivas preservam status, categoria, campos permitidos, tentativas e duração pelo bridge, transporte e diário da coleta. Os timestamps e métricas retornados pela origem permanecem inalterados e continuam sujeitos às validações de identidade, cobertura e atualização.

`tracking_set_ad_budget` e `tracking_set_ad_status` têm sempre uma única tentativa de transporte. Timeout, erro HTTP, falha ao ler a resposta ou resposta ambígua nunca autorizam reenvio. Aprovação exata, consumo único do dispatch e conferência posterior permanecem independentes. Este mecanismo não adiciona retry de CAS, gravação de banco, inferência ou alterações na Meta.


### Reserva na fronteira de elegibilidade

A consulta de identidade pode atravessar o fim de um intervalo de espera, uma mudança de agenda ou o encerramento da janela de admissão. Antes de reservar, o executor recalcula a prioridade e todo o lote elegível no estado atual, usando o mesmo instante na seleção e em `claimBatch`. Todo projeto novo do lote precisa conferir com os IDs e nomes retornados pela consulta Malva. Não reutiliza a lista antiga, não admite retroativamente e não ignora uma pausa ou trabalho prioritário que tenha chegado durante a consulta. Pedidos manuais existentes continuam sujeitos às próprias regras de elegibilidade.

### Contrato nativo de saída por modelo

A política de produção `wide` usa o contrato Chat Completions declarado para `@cf/openai/gpt-oss-120b` pelo SDK oficial Workers AI: `response_format.json_schema` contém `name` e `schema`. A declaração JSON Schema completa permanece dentro de `schema`. A política `legacy` do Llama conserva a declaração diretamente em `json_schema`; os dois contratos não são intercambiáveis. GPT-OSS recebe `reasoning_effort: low` no parâmetro nativo, além das instruções de saída curta. Teto de entrada/saída, alvos, reflexão, confronto de memória e validações numéricas não mudam.

O teste de contrato compila a chamada real capturada contra os tipos oficiais instalados por modelo, e inclui o envelope antigo como controle negativo. A conferência de conexão também usa o envelope/decodificador da política de produção, com JSON sintético mínimo, sem dados do projeto e sem criar parecer. Uma resposta `response` do modelo anterior, raciocínio sem conteúdo final, truncamento ou JSON inválido não libera a conferência. Sucesso de conectividade não demonstra qualidade da análise nem eficácia financeira.

Referências: [modelo GPT-OSS na Cloudflare](https://developers.cloudflare.com/workers-ai/models/gpt-oss-120b/), tipos oficiais `@cloudflare/workers-types` fixados no lockfile (`Base_Ai_Cf_Openai_Gpt_Oss_120B` → `ChatCompletionsInput` → `ResponseFormatJSONSchema`). O exemplo genérico de JSON Mode para Llama não substitui o contrato específico do modelo. A validação no servidor continua obrigatória; uma saída recusada não é reparada ou aproveitada parcialmente.

**Leitura do JSON final (08/11/2026).** A Cloudflare não garante o esquema JSON no gpt-oss-120b; cerca de 10% das etapas falhavam com `invalid_final_json` com término normal. O conteúdo que já é JSON é usado como está. Caso contrário, `lib/cloud-model-json.mjs` remove apenas invólucros sem perda: espaços e BOM nas bordas, uma cerca de código na abertura e/ou no fecho (o que o leitor anterior já aceitava) e o cabeçalho do canal final do gpt-oss (`<|channel|>final<|message|>` e marcadores de fim `<|return|>`/`<|end|>`) quando vaza no conteúdo, desde que apareça uma única vez e antes dele só haja mensagens completas do canal de raciocínio `analysis`; esse texto é descartado, nunca lido. Dois cabeçalhos finais, texto/JSON antes do cabeçalho, canal parecido com "final" ou preâmbulo `commentary` são recusados. Continua proibido: corrigir vírgula, completar resposta cortada, extrair objeto do meio de um texto ou escolher entre dois objetos. Uma recusa guarda só metadados fixos: `shape` (`empty`, `leading_text`, `trailing_text`, `multiple_values`, `harmony_marker`, `fenced`, `unterminated`, `invalid_syntax`), faixa de tamanho, presença de raciocínio separado e a contagem de tokens de raciocínio; nunca o conteúdo. A tentativa seguinte recebe o `shape` no `validationFeedback`.

Uma falha de formato já registrada como tentativa da etapa (limite de 3, com o aviso de correção) é repetida no mesmo pulso, dentro do teto de 4 unidades; qualquer outra falha encerra o pulso como antes. **Truncamento (finish `length`):** a falha registra se havia conteúdo parcial, a faixa de tamanho e se o fim era um trecho repetido (`repetition`, `repetitionKind` whitespace/text, detector linear sobre os últimos 8192 caracteres, sem guardar texto), além de `maxTokens` e `temperature` enviados. A tentativa seguinte da mesma etapa, só quando a imediatamente anterior foi um truncamento, usa temperatura 1 e top_p 1 (recomendação da OpenAI para o gpt-oss; a temperatura baixa favorece laços) com o mesmo teto de 6400; primeiras tentativas seguem em 0,1. Aumentar o teto foi descartado: nenhuma etapa bem-sucedida passou de 4049 tokens. Subir a temperatura de todas as chamadas fica para depois de medir `repetition`. Uma pergunta do dono que falha 3 vezes na mesma rodada por formato ou validação da IA deixa de ser repetida a cada pulso (`ownerQuestionFailures`, `lib/owner-question-limit.mjs`), para não travar as outras análises; queda do provedor não conta, uma nova rodada de coleta renova as tentativas, e o escritório mostra "Sem resposta" em vez de "Na fila".

### Fila de coletas admitidas e prazo da reserva

A reserva continua válida por 45 minutos a partir da admissão, inclusive enquanto espera na fila. Admissão, finalização e pré-conferência Cloudflare compartilham a mesma regra de validade; início futuro, relógio inválido ou reserva vencida não são trabalho atual. O prazo não é renovado para acomodar lentidão. A agenda, a pausa e a janela de admissão continuam independentes.

Conferências de envio, acompanhamento disponível, execuções aprovadas, perguntas do dono, discussões e revisões mantêm prioridade. Em seguida, coletas já admitidas são atendidas antes das etapas de modelo e das medições de aprendizado em segundo plano, evitando que várias chamadas de modelo consumam todo o prazo das reservas dos outros projetos. Projetos devidos continuam sendo reservados atomicamente antes de iniciar uma coleta; sem janela elegível não há admissão retroativa. Depois de atender as reservas, os pareceres e medições continuam normalmente.

A unidade confere reserva, dono, executor e prazo antes de consultar identidade, depois dessa consulta e novamente antes da gravação. Pesquisa profunda e comparação histórica também respeitam o prazo. Uma reserva já vencida falha sem consulta de campanhas e registra `CLOUD_COLLECTION_LEASE_EXPIRED` na etapa `reservation`; relógio inválido registra `CLOUD_COLLECTION_LEASE_INVALID`. Uma expiração durante a leitura impede importar o pacote. Fontes, análises anteriores, histórico e comandos financeiros permanecem preservados. Uma disputa CAS é identificada como `CLOUD_REVISION_CONFLICT`, sem repetir a transação ou o comando do provedor. A recuperação depende da próxima reserva realmente elegível.

Os testes reproduzem o intervalo observado em 05/11 (reserva às 22:41:49 UTC, tentativa de conclusão às 23:33:21 UTC), além de pausa, troca de dono, fronteira exata de 45 minutos, perda de CAS e seis projetos admitidos diante de pareceres pendentes. É uma proteção de fila e validade, não garantia de que todas as análises terminem dentro do intervalo configurado nem autorização para ampliar a duração das reservas.

Se uma nova prioridade surgir durante a consulta de identidade ou antes da gravação, a coleta cede a vez com resultado `deferred`, preservando a reserva original e as fontes. Isso não conclui a rodada, não registra uma falha de origem e não renova o prazo. O próximo ciclo reconsidera a fila atual.
