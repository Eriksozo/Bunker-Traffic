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
// Existing connected clients can reserve through the original job-status tool.
// These references identify projects explicitly; returned jobs always have real UUIDs.
export function agentView(current:any,live:any={}){
 const view:any=compactState(current);
 view.plan.collaboration=collaborationPlan(current.state);
 view.plan.learning=learningCyclePlan(current.state);
 view.plan.knowledge=Object.keys(current.state.config).map(project=>readKnowledgePlan(current.state,project));
 view.plan.execution=executionPlan(current.state);
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
 for(const key of ['ownerChoices','cardSuggestions','choiceLinks','decisionHistory','decisionHistoryImports','decisionHistoryOutcomes','campaignChanges','incidents','learningReviews'])delete view.state[key];
 view.runbook+='\n\n'+collaborationRunbook+'\n\n'+decisionCardsRunbook+'\n\nAcompanhamento proativo: consulte plan.watch em cada pulso. Seus sinais são prioridades de investigação, não decisões financeiras. A coleta de hoje não substitui os quatro períodos. Na próxima reserva elegível, priorize as campanhas sinalizadas, preserve o escopo completo e confira cobertura também das campanhas novas. Releia status/orçamento e histórico externo, incidente, proteção de teste, compradores/front/upsell, hierarquia e resposta após a última edição. Separe detecção, pareceres reais, síntese e aprovação exata do dono. Não reabra a mesma decisão por centavos gastos; publique apenas quando houver mudança material, sem mensagens duplicadas. Se a fonte estiver vencida/incompleta, registre a limitação; não apresente o sinal como oportunidade confirmada. Não reserve fora da cadência nem substitua fontes com execução ou revisão pendente.';
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
