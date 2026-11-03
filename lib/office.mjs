import {collaborationPlan,collaborationLimits} from './collaboration.mjs';

/** Shared logical scene coordinates: the artwork and navigation use the same geometry. */
export const officeSize=Object.freeze({width:1000,height:600});
export const officeAgents=Object.freeze([
 {id:'traffic',name:'Lia',role:'Analista de tráfego',color:'#98dfbf',x:240,y:200,description:'Períodos, funil e qualidade da aquisição.',prompts:['O que mudou desde a última revisão?','Quais campanhas merecem uma análise mais próxima?','Há aquisição nova depois do último aumento?']},
 {id:'budget',name:'Theo',role:'Guardião de orçamento',color:'#edc68a',x:760,y:200,description:'Verba, moedas e capacidade de entrega.',prompts:['Qual é a verba ativa e programada do projeto?','Onde existe margem para propor uma escala?','O orçamento está conciliado entre CBO e ABO?']},
 {id:'creative',name:'Nina',role:'Curadora de criativos',color:'#c9b4ed',x:240,y:460,description:'Front, Avatares e evolução dos criativos.',prompts:['Quais criativos estão sustentando a aquisição?','O resultado depende de upsell ou de novas compras front?','Quais variantes precisam de conciliação na Órbita?']},
 {id:'ops',name:'Cai',role:'Gestão da rodada',color:'#96cddd',x:760,y:460,description:'Histórico, demandas e relatório da operação.',prompts:['Resuma o estado da última coleta.','Quais pendências impedem uma decisão agora?','Prepare um resumo direto para a gestão.']},
].map(agent=>Object.freeze({...agent,prompts:Object.freeze(agent.prompts)})));
const rect=(x,y,width,height)=>Object.freeze({x,y,width,height});
export const officeWalls=Object.freeze([
 rect(490,20,20,240),rect(490,340,20,240),
 ...[250,330].flatMap(y=>[rect(20,y,180,20),rect(280,y,210,20),rect(510,y,210,20),rect(800,y,180,20)]),
]);
export const officeFurniture=Object.freeze([
 rect(130,100,220,60),rect(650,100,220,60),rect(130,390,220,60),rect(650,390,220,60),
]);
/** Ground footprints for the solid side decorations in the illustrated rooms. */
export const officeDecor=Object.freeze([...([0,520].flatMap(dx=>[0,310].flatMap(dy=>[
 rect(47+dx,100+dy,44,16),rect(439+dx,141+dy,16,11),
 rect(70+dx,202+dy,16,11),rect(365+dx,192+dy,84,27),
]))),
 rect(365,140,46,15),rect(413,111,37,12),rect(888,143,49,19),rect(936,149,15,7),
 rect(368,451,48,17),rect(424,463,20,5),rect(887,444,60,12),
 rect(31,306,70,16),rect(115,307,24,15),rect(159,307,16,11),rect(817,307,16,11),
 rect(846,292,87,27),rect(946,303,22,13),
]);
const grid=20,radius=6,minX=20,maxX=980,minY=20,maxY=580;
const finitePoint=p=>!!p&&Number.isFinite(p.x)&&Number.isFinite(p.y);
const key=p=>`${p.x},${p.y}`;
function collides(p,r){return p.x+radius>=r.x&&p.x-radius<=r.x+r.width&&p.y+radius>=r.y&&p.y-radius<=r.y+r.height;}
export function isWalkable(point){
 return finitePoint(point)&&point.x>=minX&&point.x<=maxX&&point.y>=minY&&point.y<=maxY&&![...officeWalls,...officeFurniture,...officeDecor].some(r=>collides(point,r));
}
const snap=p=>({x:Math.min(maxX,Math.max(minX,Math.round(p.x/grid)*grid)),y:Math.min(maxY,Math.max(minY,Math.round(p.y/grid)*grid))});
/** A bounded flood search selects a reachable destination; it never jumps an obstacle. */
export function planWalk(from,to){
 if(!finitePoint(from)||!finitePoint(to)||!isWalkable(from)||to.x<0||to.x>officeSize.width||to.y<0||to.y>officeSize.height)return [];
 const start=snap(from);if(!isWalkable(start))return [];
 const target=snap(to),startKey=key(start),queue=[start],parents=new Map([[startKey,null]]),points=new Map([[startKey,start]]);
 let closest=start,closestDistance=(start.x-target.x)**2+(start.y-target.y)**2;
 for(let index=0;index<queue.length&&index<1500;index++){
  const current=queue[index],distance=(current.x-target.x)**2+(current.y-target.y)**2;
  if(distance<closestDistance){closest=current;closestDistance=distance;}
  if(distance===0){closest=current;break;}
  for(const [dx,dy] of [[0,-grid],[grid,0],[0,grid],[-grid,0]]){
   const next={x:current.x+dx,y:current.y+dy},nextKey=key(next);
   if(parents.has(nextKey)||!isWalkable(next))continue;
   parents.set(nextKey,key(current));points.set(nextKey,next);queue.push(next);
  }
 }
 const route=[];for(let id=key(closest);id!==startKey;id=parents.get(id)){const point=points.get(id);if(!point)return [];route.push(point);}
 return route.reverse();
}
export function nearestAgent(point,maxDistance=110){
 if(!finitePoint(point)||!Number.isFinite(maxDistance)||maxDistance<0)return null;
 let nearest=null,distance=maxDistance**2;
 for(const agent of officeAgents){const d=(point.x-agent.x)**2+(point.y-agent.y)**2;if(d<=distance){nearest=agent;distance=d;}}
 return nearest;
}
/** @returns {{agentId?:string,agentName?:string,agentRole?:string}} */
export function officeMessageTarget(agentId,project,config){
 if(agentId===undefined)return {};
 const agent=officeAgents.find(a=>a.id===agentId);
 if(!agent)throw new Error('Escolha um agente válido para a conversa.');
 if(typeof project!=='string'||!project||!Object.prototype.hasOwnProperty.call(config||{},project))throw new Error('Selecione um projeto válido para conversar com o agente.');
 return {agentId:agent.id,agentName:agent.name,agentRole:agent.role};
}
/** Resolve the validated project once, then reuse the result for all four avatars. */
export function officePresencePlan(state,project,now=Date.now()){
 const byAgent={},result={state,project,at:now,byAgent};
 if(state.paused)return result;
 let plan;
 try{plan=collaborationPlan({...state,collaborationRounds:(state.collaborationRounds||[]).filter(r=>r.project===project),proposals:(state.proposals||[]).filter(p=>p.project===project)},now);}catch{return result;}
 const rounds=plan.rounds.filter(round=>!round.blocked&&!['Fonte substituída','Bloqueada','Cancelada','Falhou','Expirada'].includes(round.status));
 const validRound=new Map(rounds.map(round=>[round.roundId,round]));
 const proposals=plan.proposals.filter(proposal=>validRound.has(proposal.roundId)&&Date.parse(proposal.expiresAt)>now);
 function live(claim,agentId){
  const started=Date.parse(claim?.startedAt||''),until=Date.parse(claim?.leaseUntil||'');
  return claim?.agentId===agentId&&claim.status==='Em análise'&&typeof claim.claimId==='string'&&!!claim.claimId&&typeof claim.executionRef==='string'&&!!claim.executionRef.trim()&&Number.isFinite(started)&&Number.isFinite(until)&&started<=now&&until>now&&until>started&&until-started<=collaborationLimits.leaseMs;
 }
 for(const agent of officeAgents){
  let activity=null;
  for(const round of rounds){
   const stage=round.stages.find(stage=>stage.agentId===agent.id);
   if(round.nextAgent===agent.id&&live(stage,agent.id)){activity={type:'stage',roundId:round.roundId};break;}
   const discussion=round.discussionClaims?.[agent.id];
   if(live(discussion,agent.id)&&round.discussionPending.some(message=>message.id===discussion.replyTo&&message.toAgent===agent.id)){activity={type:'discussion',roundId:round.roundId};break;}
  }
  if(!activity)for(const proposal of proposals){
   if(proposal.status!=='Em revisão')continue;
   const stored=(state.proposals||[]).find(item=>item.id===proposal.id&&item.project===project);
   if(stored?.reviews?.some(review=>review.actor==='agent'&&review.agentId===agent.id))continue;
   if(live(stored?.reviewClaims?.[agent.id],agent.id)){activity={type:'review',roundId:proposal.roundId,proposalId:proposal.id};break;}
  }
  if(activity){
   byAgent[agent.id]={label:'Em análise',tone:'amber',detail:activity.type==='discussion'?'Uma execução conectada reservou a resposta a uma mensagem real da equipe.':activity.type==='review'?'Uma execução conectada reservou a revisão independente de uma proposta.':'Uma execução conectada reservou a leitura desta especialidade na rodada atual.',...activity};
  }else if(agent.id==='ops'&&proposals.some(proposal=>proposal.status==='Aguardando aprovação')){
   byAgent[agent.id]={label:'Aguardando aprovação',tone:'amber',detail:'Uma proposta atual, com pareceres registrados, aguarda a sua decisão. A aprovação não confirma sua aplicação na plataforma.'};
  }
 }
 return result;
}
/** @param {any} [presencePlan] Validated once by officePresencePlan for the same state, project and clock. */
export function agentPresence(state,project,id,now=Date.now(),presencePlan=null){
 if(!officeAgents.some(agent=>agent.id===id))return {label:'Agente indisponível',tone:'gray',detail:'Essa função não faz parte do escritório.'};
 if(state.paused)return {label:'Pausado',tone:'gray',detail:'O escritório está pausado. As perguntas ficam registradas para a retomada.'};
 const owner=state.agents?.[project]?.jobId;
 const running=(state.jobs||[]).find(j=>{const start=Date.parse(j.startedAt||'');return j.project===project&&j.status==='Em análise'&&(!owner||j.id===owner)&&Number.isFinite(start)&&start<=now&&now-start<45*60000;});
 if(running)return {label:'Em coleta',tone:'amber',detail:'A coleta geral do projeto está em andamento. O relatório informa a cobertura de cada função; este status não indica uma auditoria individual concluída.'};
 const collaboration=presencePlan?.state===state&&presencePlan.project===project&&presencePlan.at===now?presencePlan:officePresencePlan(state,project,now);
 if(collaboration.byAgent[id])return collaboration.byAgent[id];
 const pending=(state.messages||[]).filter(m=>m.project===project&&(m.agentId===id||(!m.agentId&&id==='ops'))&&m.status==='Pendente');
 if(pending.length)return {label:'Na fila',tone:'amber',detail:`${pending.length} ${pending.length===1?'pergunta aguarda':'perguntas aguardam'} a próxima rodada do agente conectado.`};
 if((state.jobs||[]).some(j=>j.project===project&&j.status==='Pendente'))return {label:'Revisão na fila',tone:'amber',detail:'Uma coleta geral do projeto foi solicitada e aguarda o agente conectado.'};
 return {label:'Aguardando pedidos',tone:'gray',detail:'Deixe uma pergunta para a próxima rodada. As respostas aparecem quando o agente conectado as registrar.'};
}

/** Pending questions are durable work; trim only completed history in the live buffer. */
export function retainOfficeMessages(messages,limit=80){
 const pending=messages.filter(message=>message.status==='Pendente');
 const settled=messages.filter(message=>message.status!=='Pendente').slice(0,Math.max(0,limit-pending.length));
 const keep=new Set([...pending,...settled]);return messages.filter(message=>keep.has(message));
}
export function assertOfficeQueueCapacity(messages,limit=80){
 if(messages.filter(message=>message.status==='Pendente').length>=limit)throw new Error(`A fila já tem ${limit} perguntas pendentes. Aguarde uma resposta antes de enviar outra.`);
}
/** A retried answer cannot replace an answer already delivered or its addressed role. */
export function answerOfficeMessage(message,text,now){
 if(message.status==='Respondida')return false;
 if(message.status!=='Pendente')throw new Error('Esta pergunta não está pendente.');
 message.answer=text;message.status='Respondida';message.answeredAt=now;return true;
}
