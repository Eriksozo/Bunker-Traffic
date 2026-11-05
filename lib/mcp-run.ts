import {campaignCoveragePlan} from './campaign-learning-coverage.mjs';
import {externalLearningPlan} from './external-learning.mjs';
import {autonomousLearningPlan} from './learning-outcomes.mjs';
import {briefAgentPlans} from './agent-briefing.mjs';
import {claim,claimBatch,compactState} from './agent-state.ts';
import {collaborationPlan} from './collaboration.mjs';
import {readKnowledgePlan} from './knowledge.mjs';
import {collaborationRunbook} from './collaboration-runbook.mjs';
import {executionPlan} from './execution.mjs';
import {decisionLearningSummary} from './decision-learning-view.mjs';
import {decisionCardsRunbook} from './decision-cards-runbook.mjs';
import {learningCyclePlan} from './learning-cycle.mjs';
import {autonomousWorkPlan} from './autonomous-work.mjs';
import {campaignWatchPlan} from './campaign-watch.mjs';
import {contingencyPlan} from './decision-contingency.mjs';
// Existing connected clients can reserve through the original job-status tool.
// These references identify projects explicitly; returned jobs always have real UUIDs.
export function agentView(current:any,live:any={}){
 const view:any=compactState(current);
 view.plan.collaboration=collaborationPlan(current.state);
 view.plan.learning=learningCyclePlan(current.state);
 const measurements=autonomousLearningPlan(current.state);view.plan.learning.automaticMeasurement={ready:measurements.readyCount,waiting:measurements.waitingCount,limits:measurements.policy,waitingReasons:measurements.waiting};
 view.plan.learning.campaignCoverage=campaignCoveragePlan(current.state);
 view.plan.learning.automaticHistory=externalLearningPlan(current.state);
 view.plan.knowledge=Object.keys(current.state.config).map(project=>readKnowledgePlan(current.state,project));
 view.plan.execution=executionPlan(current.state);
 view.plan.contingency=contingencyPlan(current.state,live.items||[]);
 view.plan.watch=campaignWatchPlan(current.state,{...live,due:view.plan.due});
 for(const p of view.plan.watch.projects){delete p.preview;p.readRequest={tool:'bunker_atualizar_rodada',arguments:{revision:0,id:'watch-data',status:'Pendente',note:JSON.stringify({action:'read',projectId:p.projectId,offset:0,limit:25})}};}
 const priority=new Map(view.plan.watch.priorityProjects.map((id:string,i:number)=>[id,i]));
 view.plan.due.sort((a:any,b:any)=>(priority.get(a.project) as number)-(priority.get(b.project) as number));
 view.plan.autonomous=autonomousWorkPlan(current.state,view.plan);
 view.plan.autonomous.monitoring={signalCount:view.plan.watch.signalCount,projects:view.plan.watch.priorityProjects,rule:view.plan.watch.rule};
 view.plan.campaignMonitoring={incidents:(current.state.incidents||[]).slice(-30),changes:(current.state.campaignChanges||[]).slice(-50),incidentCount:(current.state.incidents||[]).length,changeCount:(current.state.campaignChanges||[]).length,notice:'Diferença entre leituras não prova ator, horário exato ou causa. Incidentes são comunicações do dono. Reconciliar antes de novos pareceres.'};
 view.plan.decisions=decisionLearningSummary(current.state);
 // The browser retains full journals. Repeating them in every MCP heartbeat
 // would duplicate source data and hide pending work in a very large response.
 for(const key of ['ownerChoices','cardSuggestions','choiceLinks','decisionHistory','decisionHistoryImports','decisionHistoryOutcomes','campaignChanges','incidents','learningReviews','agentEpisodes'])delete view.state[key];
 view.runbook+=' Contingência operacional: ler plan.contingency antes de qualquer ampliação de risco. Tetos e lossCap ausentes não são zero ou licença ilimitada. lossCap é perda da rodada, não o prejuízo total do dia; sem mesmo dia e escopo, deixar N/D. Uma reserva por proprietário CBO/ABO; timeout após envio exige conferência e nunca reenvio. Em executionPrepare e executionConfirm, se a fonte trouxer desempenho normalizado em BRL, enviar metricsCurrency BRL, from/to/timezone e os valores realmente lidos no observation; não inventar moeda ou baseline. Após confirmação, atender os followUp de 15/30/60 com dados novos já disponíveis; ler cacheRead, conferir escopo e registrar action executionMonitor com id, entry.checkpointMinutes, observation, clientId e executionRef real. Clientes com catálogo antigo usam bunker_atualizar_rodada com id collaboration, status Pendente, revision atual e note JSON contendo esses campos. Atraso não pode ser retrodatado. Se não houver cache novo, aguardar coleta elegível na cadência. Despacho pendente é verificação primeiro. Reversão ou contenção financeira exige nova proposta, pareceres, aprovação exata e envio único; nunca aprovar pelo dono nem tratar previsão como gatilho financeiro.';
 view.runbook+='\n\n'+collaborationRunbook+'\n\n'+decisionCardsRunbook+'\n\nAcompanhamento proativo: consulte plan.watch em cada pulso. Seus sinais são prioridades de investigação, não decisões financeiras. A coleta de hoje não substitui os quatro períodos. Na próxima reserva elegível, priorize as campanhas sinalizadas, preserve o escopo completo e confira cobertura também das campanhas novas. Releia status/orçamento e histórico externo, incidente, proteção de teste, compradores/front/upsell, hierarquia e resposta após a última edição. Separe detecção, pareceres reais, síntese e aprovação exata do dono. Não reabra a mesma decisão por centavos gastos; publique apenas quando houver mudança material, sem mensagens duplicadas. Se a fonte estiver vencida/incompleta, registre a limitação; não apresente o sinal como oportunidade confirmada. Não reserve fora da cadência nem substitua fontes com execução ou revisão pendente.';
 view.plan=briefAgentPlans(view.plan,current.state);
 view.runbook+=' EXECUTOR NA NUVEM: Durable Object e Workers AI conduzem as revisões sem depender do Mac ou GPT quando ativados pelo dono na dashboard. A tarefa local permanece pausada. Cadência e pausa salvas continuam soberanas. O agente conectado não pode ativar, pausar nem aprovar pelo dono. A conexão MCP própria é distinta da API REST. Órbita sem credencial independente permanece uma limitação explícita. Coleta dos 12 recortes não equivale a análise individual de todos os objetos: cada unidade prioriza até seis campanhas e registra cobertura.';
 view.runbook+=' LEITURA DIRETA: plan.sourceReads permite consultar a API Malva no Supabase sem o Mac para projetos alcançados pela chave. Descubra o alcance primeiro; use period four para 7d/3d/ontem completos e hoje parcial, level campaign/adset/ad e filtros exatos. Fonte Malva API é distinta do MCP; preserve sourceFreshAt, sourceCache e lastSyncAt, recusando stale para decisão. A resposta não importa nem sela fontes: concilie-a com a rodada e preserve o contrato de execução MCP e aprovação. Falta de acesso não é campanha sem resultado. Demais projetos e Órbita continuam pelos seus conectores. A pausa e a cadência continuam obrigatórias; leitura não reserva nem reabre rodadas.';
 view.runbook+=' EFICIÊNCIA: este resumo omite arquivos históricos, não apaga dados. Use os readRequest de review-data para ler contexto e fontes paginadas de um único projeto antes de cada etapa. Consulte aprendizados e escolhas pelo projeto, sem baixar todo o histórico em cada escrita. Publique resultados por projeto assim que confirmados; não espere os demais. Releia revision antes da escrita; releitura não exige repetir a coleta ou os pareceres. O painel Revisões dos agentes mostra o progresso real e recebe pedidos do dono.';
 return {...view,plan:{...view.plan,due:view.plan.due.map((d:any)=>({...d,startRequest:{tool:'bunker_atualizar_rodada',arguments:{revision:current.revision,id:`project:${d.project}`,status:'Em análise'}}})),...(view.plan.due.length?{batchStartRequest:{tool:'bunker_atualizar_rodada',arguments:{revision:current.revision,id:'projects:due',status:'Em análise',note:JSON.stringify({projectIds:view.plan.due.map((d:any)=>d.project)})}}}:{})},runbook:view.runbook+' Para reservar todos os projetos devidos no mesmo pulso, use plan.batchStartRequest antes de iniciar novas coletas de campanhas, após processar execuções já aprovadas/conferências pendentes. O lote é atômico, devolve os jobs reais e preserva o horário único de admissão inclusive no último horário da agenda; as coletas podem terminar depois dentro dos leases. Para uma reserva individual use bunker_iniciar_rodada({projectId,revision}). Se o cliente ainda não expõe essa ferramenta, use o startRequest retornado em plan.due pela ferramenta existente bunker_atualizar_rodada. Isso reserva o projeto e devolve o ID real da rodada; use esse ID para concluir. Uma falha pode ser encerrada como Cancelada com motivo se o cliente não expuser Falhou. Não improvise endpoints. Perguntas com agentId/agentName/agentRole pertencem à função virtual indicada: responder no escopo de tráfego, orçamento, criativos ou gestão, sempre no mesmo projeto e id de mensagem. Mensagens legadas sem agente pertencem à gestão geral (ops). A conversa é assíncrona; não alegar presença online, digitação, auditoria individual completa ou ajuste de campanhas sem evidência. Respostas já entregues são imutáveis; correções devem ir numa nova mensagem.'};
}
export function reserveRequest(state:any,args:any,now=new Date()){
 if(args.id==='projects:due'&&args.status==='Em análise'){
  let input;try{input=JSON.parse(args.note);}catch{throw new Error('Informe o JSON do lote retornado em plan.batchStartRequest.');}
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Lote de projetos inválido.');
  return claimBatch(state,input.projectIds,args.revision,now);
 }
 const projectId=args.projectId||args.project||(args.status==='Em análise'&&args.id?.startsWith('project:')?args.id.slice(8):null);
 if(!projectId)throw new Error('Informe projectId ou use a referência de reserva retornada pela central.');
 return claim(state,projectId,args.revision,now);
}
