import {campaignReassessment} from './campaign-reassessment.mjs';
/** Decision support and owner feedback. No function here calls an ad provider.
 * Choices describe preferences; only an exact existing proposal may be approved.
 */
import {reconsiderationPlan} from './decision-reconsider.mjs';
import {sum,phase} from './analysis.mjs';
import {collaborationPlan,reviewProposal} from './collaboration.mjs';
import {recordOutcome} from './knowledge.mjs';
import {readChoiceResolution} from './decision-resolution.mjs';
import {isWarmupCampaign,isWarmupTarget} from './campaign-scope.mjs';
import {decisionContext} from './decision-context.mjs';

export const decisionCardLimits=Object.freeze({choices:500,suggestions:500,suggestionAliases:20,suggestionBatchReceipts:20,historyPerImport:500,history:5000,sourceAgeMs:60*60000});
const periods=['7d','3d','yesterday','today'],actions=['increase','reduce','pause','keep'];
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o||{},k);
const copy=v=>JSON.parse(JSON.stringify(v));
const list=(s,k)=>{if(s[k]!==undefined&&!Array.isArray(s[k]))throw Error(`Arquivo ${k} inválido.`);return s[k]||[];};
const text=(v,label,max=500)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw Error(`${label} inválido.`);return v.trim();};
const instant=v=>{const n=typeof v==='number'?v:Date.parse(v);if(!Number.isFinite(n))throw Error('Instante inválido.');return n;};
const iso=v=>new Date(instant(v)).toISOString();
function canonical(v){if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';if(v&&typeof v==='object')return '{'+Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';return JSON.stringify(v);}
/** Integrity marker, not an authorization credential. */
function seal(v){const s=canonical(v);let a=2166136261,b=3335557771;for(let i=0;i<s.length;i++){a=Math.imul(a^s.charCodeAt(i),16777619);b=Math.imul(b^s.charCodeAt(i),2246822519);}return 'v1-'+(a>>>0).toString(16).padStart(8,'0')+(b>>>0).toString(16).padStart(8,'0');}
const objectKey=r=>JSON.stringify([r.adAccountId,r.externalId]);
const cardId=(project,row)=>'campaign:'+encodeURIComponent(project)+':'+encodeURIComponent(row.adAccountId)+':'+encodeURIComponent(row.externalId);
function projectOf(state,value){const p=text(value,'Projeto',250);if(!own(state.config,p))throw Error('Projeto não configurado.');return p;}
function capacity(items,max,label){if(items.length>=max)throw Error(`Limite de ${max} ${label} atingido. Exporte o histórico; nenhum registro será apagado.`);}
function percentOf(action,value){if(!actions.includes(action))throw Error('Escolha inválida.');if(action==='increase'||action==='reduce'){if(typeof value!=='number'||!Number.isFinite(value)||value<=0||value>(action==='increase'?1000:100)||action==='reduce'&&value>=100)throw Error('Percentual inválido: aumento até 1000%; redução maior que 0 e menor que 100%.');return value;}if(value!==undefined&&value!==null)throw Error('Esta escolha não aceita percentual.');return null;}
const cents=v=>Math.round((v+Number.EPSILON)*100)/100;
function afterFor(row,action,percent){if(action==='keep')return {dailyBudget:row.dailyBudget??null,status:row.status??null};if(action==='pause'){if(row.status!=='ACTIVE')throw Error('Só é possível propor pausa de campanha ACTIVE.');return {status:'PAUSED'};}if(typeof row.dailyBudget!=='number'||!Number.isFinite(row.dailyBudget)||row.dailyBudget<=0||row.lifetimeBudget>0)throw Error('Orçamento diário nativo válido obrigatório.');const value=cents(row.dailyBudget*(1+(action==='increase'?1:-1)*percent/100));if(value<=0||value>1e9||value===row.dailyBudget)throw Error('A variação não produz orçamento diário válido em centavos.');return {dailyBudget:value};}
function currentSources(state,project){return periods.map(period=>{const matches=(state.snapshots||[]).filter(s=>s.projectId===project&&s.period===period&&s.level==='campaign');return matches.length===1?matches[0]:null;});}
function sourceMeta(s){return s?{period:s.period,level:s.level,from:s.from,to:s.to,timezone:s.timezone,fetchedAt:s.fetchedAt,lastSyncAt:s.lastSyncAt??null,source:s.source,complete:s.complete===true,rowCount:s.rows?.length||0,fingerprint:seal(s)}:null;}
function proposalIntact(p){return p.signature===seal({id:p.id,roundId:p.roundId,project:p.project,version:p.version,expiresAt:p.expiresAt,supersedes:p.supersedes||null,payload:p.payload});}
function proposalSuggestion(p){const v=p.payload;if(v.action==='status'&&v.after?.status==='PAUSED')return {action:'pause',percent:null,reason:v.reason,origin:'proposal'};if(v.action==='budget'&&Number.isFinite(v.before?.dailyBudget)&&v.before.dailyBudget>0&&Number.isFinite(v.after?.dailyBudget)){const change=(v.after.dailyBudget/v.before.dailyBudget-1)*100;return {action:change>0?'increase':'reduce',percent:Math.abs(change),reason:v.reason,origin:'proposal'};}return null;}
function contextHash(row,cut,config,roundId,monitor){return seal({row,sourceCut:cut,config,roundId,...(monitor?{reviewMarker:monitor.markerId,reviewAt:monitor.at}:{})});}
function linked(state,choice,now){const link=list(state,'choiceLinks').find(l=>l.choiceId===choice.id),proposal=(state.proposals||[]).find(p=>p.id===(link?.proposalId||choice.proposalId)),resolution=readChoiceResolution(state,choice,now);return {...copy(choice),...(link?{link:copy(link)}:{}),...(proposal?{proposalStatus:proposal.status,executionStatus:proposal.execution?.status||null}:{}),...(resolution?{resolution:copy(resolution),proposalStatus:'Aprovada',executionStatus:'Confirmada'}:{})};}

/** Current campaign cards. Diagnostics never pretend to be a team recommendation. */
export function buildDecisionCards(state,project,now=Date.now()){
 const at=instant(now),projects=project&&project!=='all'?[projectOf(state,project)]:Object.keys(state.config||{}),plan=collaborationPlan(state,at),cards=[];
 for(const p of projects){
  const sources=currentSources(state,p),cut=sources.map(sourceMeta).filter(Boolean),indexes=sources.map(s=>{const map=new Map();for(const r of s?.rows||[]){const key=objectKey(r);map.set(key,map.has(key)?null:r);}return map;});
  const keys=new Set(indexes.flatMap(m=>[...m.keys()])),validRound=plan.rounds.filter(r=>r.project===p&&!r.blocked).sort((a,b)=>Date.parse((state.collaborationRounds||[]).find(r=>r.id===b.roundId)?.createdAt||'')-Date.parse((state.collaborationRounds||[]).find(r=>r.id===a.roundId)?.createdAt||''))[0];
  for(const key of keys){
   const today=indexes[3].get(key),fallback=indexes.map((m,i)=>({row:m.get(key),s:sources[i]})).filter(x=>x.row).sort((a,b)=>Date.parse(b.s.fetchedAt)-Date.parse(a.s.fetchedAt))[0],row=today||fallback?.row;
   if(!row||String(row.provider||'').toLowerCase()!=='meta'||isWarmupCampaign(row.name))continue;
   const id=cardId(p,row),windows={};for(let i=0;i<periods.length;i++){const r=indexes[i].get(key),s=sources[i];windows[periods[i]]=r?{...sum([r]),from:s.from,to:s.to,timezone:s.timezone,fetchedAt:s.fetchedAt,partial:periods[i]==='today'}:null;}
   const round=validRound?(state.collaborationRounds||[]).find(r=>r.id===validRound.roundId):null;
   const opinions=['traffic','creative','budget'].map(agentId=>{const stage=round?.stages?.find(s=>s.agentId===agentId&&s.status==='Concluída');const m=(state.collaborationMessages||[]).find(m=>m.id===stage?.conclusionId&&m.roundId===round.id&&m.kind==='conclusion'&&m.fromAgent===agentId);return m&&opinionCovers(state,m,row)?{agentId,id:m.id,text:m.text,...(m.summary?{summary:copy(m.summary)}:{})}:null;}).filter(Boolean);
   const lastChoice=list(state,'ownerChoices').filter(c=>c.project===p&&c.cardId===id).at(-1)||null;
   const monitor=campaignReassessment(state,p,row,{sourceCut:cut,round,teamReady:opinions.length===3,lastChoice});
   const hash=contextHash(row,cut,state.config[p],round?.id||null,monitor),proposal=(state.proposals||[]).filter(x=>x.project===p&&x.roundId===round?.id&&x.payload?.level==='campaign'&&x.payload.adAccountId===row.adAccountId&&x.payload.objectId===row.externalId&&['Em revisão','Aguardando aprovação','Aprovada'].includes(x.status)&&Date.parse(x.expiresAt)>at&&proposalIntact(x)).sort((a,b)=>b.version-a.version||Date.parse(b.createdAt)-Date.parse(a.createdAt))[0]||null;
   const recorded=list(state,'cardSuggestions').filter(x=>x.project===p&&x.adAccountId===row.adAccountId&&x.objectId===row.externalId&&x.contextHash===hash&&x.roundId===round?.id).at(-1);
   const suggestion=!(monitor?.requiresReview)&&proposal&&proposalSuggestion(proposal)||recorded&&{action:recorded.action,percent:recorded.percent,reason:recorded.reason,origin:'team'}||{action:'keep',percent:null,reason:'Diagnóstico: comparar aquisição, última edição e os quatro períodos. Ainda não há sugestão conjunta registrada para esta campanha.',origin:'diagnostic'};
   const fetched=Date.parse(sources[3]?.fetchedAt||''),fresh=Number.isFinite(fetched)&&fetched<=at+5000&&at-fetched<=decisionCardLimits.sourceAgeMs,complete=!!today&&sources[3]?.source==='Malva MCP'&&sources[3]?.complete===true;
   const native=/^[A-Z]{3}$/.test(row.budgetCurrency||''),daily=Number.isFinite(row.dailyBudget)&&row.dailyBudget>0&&!(row.lifetimeBudget>0),blockedReasons=[];
   if(state.paused)blockedReasons.push('Escritório pausado.');if(!complete)blockedReasons.push('Leitura completa de hoje da campanha ausente.');if(!fresh)blockedReasons.push('Leitura de hoje vencida ou com data inválida.');if(sources.some(s=>!s||s.complete!==true||s.source!=='Malva MCP'))blockedReasons.push('As quatro janelas completas ainda não estão disponíveis.');if(!round)blockedReasons.push('Rodada conjunta válida ainda não está disponível.');if(opinions.length!==3)blockedReasons.push('Faltam pareceres da equipe para esta campanha ou sua hierarquia.');if(!native)blockedReasons.push('Moeda nativa não confirmada.');if(!daily)blockedReasons.push('Orçamento diário próprio não confirmado.');if(!state.config[p]?.targetRoas)blockedReasons.push('Meta de retorno do projeto não configurada.');if(!state.config[p]?.dailyCap)blockedReasons.push('Teto diário autorizado do projeto não configurado.');if(row.accountStatus?.active===false)blockedReasons.push('Conta de anúncios sem aptidão ativa.');
   if(monitor?.requiresReview)blockedReasons.push('O cenário mudou: aguarde a releitura e novos pareceres.');
   const signature=seal({id,project:p,lastChoiceId:lastChoice?.id||null,row,sourceCut:cut,config:state.config[p],roundId:round?.id||null,contextHash:hash,suggestion,teamOpinions:opinions,proposal:proposal?{id:proposal.id,version:proposal.version,signature:proposal.signature,status:proposal.status,expiresAt:proposal.expiresAt}:null});
   cards.push({id,signature,monitor,targetRoas:state.config[p]?.targetRoas??null,project:p,roundId:round?.id||null,row:copy(row),windows,context:decisionContext(windows),sourceAt:sources[3]?.fetchedAt||fallback?.s.fetchedAt||null,sourceCut:copy(cut),phase:phase(row.name),teamOpinions:opinions,teamReady:opinions.length===3&&!monitor?.requiresReview,suggestion,proposal:proposal&&!monitor?.requiresReview?copy(proposal):null,blockedReasons,actionable:{increase:!monitor?.requiresReview&&!state.paused&&fresh&&complete&&native&&daily,reduce:!monitor?.requiresReview&&!state.paused&&fresh&&complete&&native&&daily,pause:!monitor?.requiresReview&&!state.paused&&fresh&&complete&&native&&row.status==='ACTIVE',keep:!monitor?.requiresReview},contextHash:hash,lastChoice:copy(lastChoice)});
  }
 }
 return cards.sort((a,b)=>(b.windows.today?.spend||0)-(a.windows.today?.spend||0)||a.id.localeCompare(b.id));
}

function opinionCovers(state,message,row){return (message.evidenceRefs||[]).some(ref=>{if(ref.empty||ref.adAccountId!==row.adAccountId)return false;if(ref.level==='campaign'&&ref.externalId===row.externalId)return true;const s=(state.snapshots||[]).find(s=>s.projectId===message.project&&s.period===ref.period&&s.level===ref.level&&s.fetchedAt===ref.fetchedAt);return s?.rows.some(r=>r.adAccountId===ref.adAccountId&&r.externalId===ref.externalId&&r.campaignExternalId===row.externalId);});}
function choiceRequest(args,ownerId){return seal({project:args.project,cardId:args.cardId,signature:args.signature,choice:args.choice,percent:args.percent??null,reason:args.reason?.trim()||'',ownerId,approveExact:args.approveExact===true,proposalId:args.proposalId??null,proposalVersion:args.proposalVersion??null,proposalSignature:args.proposalSignature??null});}
function exactChoice(choice,p){return p.project===choice.project&&p.payload?.level==='campaign'&&p.payload.adAccountId===choice.adAccountId&&p.payload.objectId===choice.objectId&&p.payload.currency===choice.currency&&(choice.action==='pause'?p.payload.action==='status'&&p.payload.before?.status===choice.before.status&&p.payload.after?.status==='PAUSED':['increase','reduce'].includes(choice.action)&&p.payload.action==='budget'&&p.payload.before?.dailyBudget===choice.before.dailyBudget&&p.payload.after?.dailyBudget===choice.after.dailyBudget);}

/** Owner identity is supplied by the authenticated server, never from args. */
export function recordOwnerChoice(state,args,ownerId,now=Date.now()){
 const at=instant(now),owner=text(ownerId,'Dono autenticado',250),clientId=text(args.clientId,'clientId',150),choices=list(state,'ownerChoices'),digest=choiceRequest(args,owner),replay=choices.find(c=>c.clientId===clientId);
 if(replay){if(replay.requestFingerprint!==digest)throw Error('clientId já utilizado por outra decisão.');return replay;}
 // A lost response or another mounted instance may retry the identical sealed
 // intent with a fresh clientId. Return its original record, never a new vote.
 const identical=choices.find(c=>c.ownerId===owner&&c.requestFingerprint===digest);
 if(identical)return identical;
 const p=projectOf(state,args.project),card=buildDecisionCards(state,p,at).find(c=>c.id===args.cardId);if(!card||card.signature!==args.signature)throw Error('O card mudou. Atualize antes de decidir.');
 if(args.choice==='keep'&&args.approveExact===true)throw Error('Manter não é uma autorização de execução.');
 const reopened=list(state,'decisionReopens').find(r=>r.project===p&&r.cardId===card.id&&r.choiceId===card.lastChoice?.id);
 if(card.lastChoice&&!reopened&&!card.monitor?.afterChoice)throw Error('Esta campanha já tem uma decisão registrada. Abra o Histórico e use Rever cenário para decidir novamente.');
 const action=args.choice,percent=percentOf(action,args.percent);if(!card.actionable[action])throw Error('A fonte, o orçamento ou o status atual não permitem esta escolha financeira. Atualize os dados.');
 capacity(choices,decisionCardLimits.choices,'decisões do dono');const before={dailyBudget:card.row.dailyBudget??null,status:card.row.status??null},after=afterFor(card.row,action,percent);
 const record={id:crypto.randomUUID(),clientId,requestFingerprint:digest,ownerId:owner,project:p,cardId:card.id,cardSignature:card.signature,roundId:card.roundId,objectId:card.row.externalId,internalObjectId:card.row.id??null,adAccountId:card.row.adAccountId,name:card.row.name,accountName:card.row.accountName,currency:card.row.budgetCurrency??null,budgetRate:card.row.budgetRate??null,action,choice:action,percent,before,after,reason:args.reason===undefined?'':text(args.reason||'Sem motivo adicional.','Motivo',2500),suggestedAction:card.suggestion.action,suggestedPercent:card.suggestion.percent,suggestionOrigin:card.suggestion.origin,sourceCut:copy(card.sourceCut),windows:copy(card.windows),config:copy(state.config[p]),teamOpinionIds:card.teamOpinions.map(x=>x.id),status:action==='keep'?'Mantido':'Pendente de revisão',createdAt:iso(at),financialOutcome:'N/D',proposalId:null};
 if(args.approveExact===true){
  if(action==='keep')throw Error('Manter não é uma autorização de execução.');const proposal=(state.proposals||[]).find(x=>x.id===args.proposalId);
  if(!proposal||proposal.id!==card.proposal?.id||args.proposalVersion!==proposal.version||args.proposalSignature!==proposal.signature||!exactChoice(record,proposal))throw Error('A escolha não corresponde à proposta exata revisada. Salve a intenção e solicite nova revisão.');
  // Validate on a clone so a rejected review cannot partially mutate the journal.
  const staged=copy(state);reviewProposal(staged,{id:proposal.id,version:proposal.version,signature:proposal.signature,decision:'approve',comment:record.reason||'Ação exata exibida no card aprovada pelo dono.',clientId:clientId+':review'},{kind:'owner',id:owner},at);
  record.status='Autorizado';record.proposalId=proposal.id;record.proposalVersion=proposal.version;record.proposalSignature=proposal.signature;state.proposals=staged.proposals;
 }
 if(reopened)record.reconsidersChoiceId=reopened.choiceId;
 if(card.monitor?.afterChoice){record.reviewMarkerId=card.monitor.markerId;if(card.lastChoice)record.reconsidersChoiceId=card.lastChoice.id;}
 state.ownerChoices=[...choices,record];return record;
}

/** An OPS-authored recommendation is distinct from an executable proposal. */
const batchReceipts=item=>[...(item.batchReceipt?[item.batchReceipt]:[]),...(Array.isArray(item.batchReceipts)?item.batchReceipts:[])];
function suggestionAliases(item){if(item.requestAliases!==undefined&&!Array.isArray(item.requestAliases))throw Error('Arquivo de aliases da sugestão inválido.');return item.requestAliases||[];}
function appendCardSuggestion(state,args,now=Date.now(),cached=null){
 const at=instant(now),clientId=text(args.clientId,'clientId',150),items=list(state,'cardSuggestions'),payload=args.payload||{},digest=seal({roundId:args.roundId,claimId:args.claimId,executionRef:args.executionRef,payload}),replay=items.find(x=>x.clientId===clientId||suggestionAliases(x).some(alias=>alias.clientId===clientId));
 if(replay){const prior=replay.clientId===clientId?replay:suggestionAliases(replay).find(alias=>alias.clientId===clientId);if(prior.requestFingerprint!==digest)throw Error('clientId já utilizado por outra sugestão.');return replay;}
 const round=cached?.round||(state.collaborationRounds||[]).find(r=>r.id===args.roundId),planned=cached?.planned||collaborationPlan(state,at).rounds.find(r=>r.roundId===args.roundId);if(state.paused||!round||planned?.blocked)throw Error('Rodada de colaboração não está disponível.');
 const ops=round.stages.find(s=>s.agentId==='ops');if(!ops||ops.claimId!==args.claimId||ops.executionRef!==args.executionRef||!['Em análise','Concluída'].includes(ops.status)||Date.parse(ops.leaseUntil)<=at||Date.parse(ops.startedAt)>at)throw Error('Reserva OPS viva obrigatória.');
 const card=(cached?.cards||buildDecisionCards(state,round.project,at)).find(c=>c.roundId===round.id&&c.row.externalId===payload.objectId&&c.row.adAccountId===payload.adAccountId);if(!card||!card.teamReady)throw Error('Sugestão exige os três pareceres reais da campanha ou sua hierarquia.');
 if(!Array.isArray(payload.opinionRefs)||payload.opinionRefs.length!==3||new Set(payload.opinionRefs).size!==3||card.teamOpinions.some(x=>!payload.opinionRefs.includes(x.id)))throw Error('Referencie as três conclusões atuais da equipe.');
 const action=payload.action,percent=percentOf(action,payload.percent);if(action!=='keep'&&!card.actionable[action])throw Error('Sugestão financeira exige fonte e contexto atuais.');if(action!=='keep')afterFor(card.row,action,percent);
 const reason=text(payload.reason,'Motivo da sugestão',4000),opinions=canonical([...payload.opinionRefs].sort());
 // A fresh transport ID is not a new recommendation when the exact current
 // campaign, source context, choice, rationale and three opinions are unchanged.
 // Validate the live OPS context above before accepting this semantic replay.
 const latest=items.filter(item=>item.project===round.project&&item.roundId===round.id&&item.objectId===card.row.externalId&&item.adAccountId===card.row.adAccountId&&item.contextHash===card.contextHash).at(-1);
 if(latest&&latest.action===action&&latest.percent===percent&&latest.reason===reason&&Array.isArray(latest.opinionRefs)&&canonical([...latest.opinionRefs].sort())===opinions){
  const aliases=suggestionAliases(latest);capacity(aliases,decisionCardLimits.suggestionAliases,'aliases da sugestão');
  const recorded={...latest,requestAliases:[...aliases,{clientId,requestFingerprint:digest,createdAt:iso(at)}]};state.cardSuggestions=items.map(item=>item===latest?recorded:item);return recorded;
 }
 capacity(items,decisionCardLimits.suggestions,'sugestões');const record={id:crypto.randomUUID(),clientId,requestFingerprint:digest,project:round.project,roundId:round.id,objectId:card.row.externalId,adAccountId:card.row.adAccountId,action,percent,reason,opinionRefs:[...payload.opinionRefs],contextHash:card.contextHash,executionRef:ops.executionRef,claimId:ops.claimId,createdAt:iso(at)};state.cardSuggestions=[...items,record];return record;
}
export function recordCardSuggestion(state,args,now=Date.now()){
 if(!own(args.payload,'items'))return appendCardSuggestion(state,args,now);
 const entries=args.payload.items;
 if(!Array.isArray(entries)||entries.length<1||entries.length>100)throw Error('Lote de sugestões deve conter de 1 a 100 campanhas.');
 const baseClientId=text(args.clientId,'clientId',146),batchFingerprint=seal({roundId:args.roundId,claimId:args.claimId,executionRef:args.executionRef,items:entries});
 const receipt=list(state,'cardSuggestions').flatMap(batchReceipts).find(r=>r.clientId===baseClientId);
 if(receipt){
  if(receipt.requestFingerprint!==batchFingerprint)throw Error('clientId já utilizado por outro lote de sugestões.');
  const records=receipt.recordIds.map(id=>list(state,'cardSuggestions').find(r=>r.id===id));
  if(records.length!==entries.length||records.some(r=>!r))throw Error('Recibo do lote incompleto; conferir o histórico antes de repetir.');
  return {count:records.length,records};
 }
 const seen=new Set();for(const entry of entries){const key=JSON.stringify([entry?.adAccountId,entry?.objectId]);if(seen.has(key))throw Error('Campanha repetida no lote de sugestões.');seen.add(key);}
 // One synchronous frozen context and a staged journal make the batch atomic.
 // Every item still passes the same OPS, opinion, identity and value guards.
 const staged=copy(state),at=instant(now),round=(staged.collaborationRounds||[]).find(r=>r.id===args.roundId),planned=collaborationPlan(staged,at).rounds.find(r=>r.roundId===args.roundId);
 const cached={round,planned,cards:round?buildDecisionCards(staged,round.project,at):[]};
 const records=entries.map((payload,i)=>appendCardSuggestion(staged,{...args,clientId:baseClientId+':'+i,payload},at,cached));
 const batchReceipt={clientId:baseClientId,requestFingerprint:batchFingerprint,recordIds:records.map(r=>r.id)};
 // Semantic reuse may make this the first record of several batches. Preserve
 // every prior receipt so either batch can replay its exact immutable result.
 capacity(batchReceipts(records[0]),decisionCardLimits.suggestionBatchReceipts,'recibos de lote da sugestão');
 if(!records[0].batchReceipt)records[0].batchReceipt=batchReceipt;
 else records[0].batchReceipts=[...(records[0].batchReceipts||[]),batchReceipt];
 state.cardSuggestions=staged.cardSuggestions;
 return {count:records.length,records};
}

/** Links, but never approves, a freshly reviewed proposal matching an earlier choice. */
export function linkChoiceProposal(state,args,now=Date.now()){
 const at=instant(now),choice=list(state,'ownerChoices').find(c=>c.id===args.choiceId),proposal=(state.proposals||[]).find(p=>p.id===args.proposalId),links=list(state,'choiceLinks');
 if(!choice||!proposal||choice.action==='keep'||!exactChoice(choice,proposal)||!proposalIntact(proposal))throw Error('Proposta não corresponde à escolha exata.');
 const planned=collaborationPlan(state,at).rounds.find(r=>r.roundId===proposal.roundId);if(!planned||planned.blocked||Date.parse(proposal.expiresAt)<=at||!['Em revisão','Aguardando aprovação','Aprovada'].includes(proposal.status))throw Error('Proposta vinculada precisa de contexto válido.');
 const existing=links.find(x=>x.choiceId===choice.id);if(existing){if(existing.proposalId!==proposal.id||existing.proposalSignature!==proposal.signature)throw Error('Escolha já vinculada a outra versão.');return existing;}
 capacity(links,decisionCardLimits.choices,'vínculos de escolhas');const record={id:crypto.randomUUID(),choiceId:choice.id,project:choice.project,proposalId:proposal.id,proposalVersion:proposal.version,proposalSignature:proposal.signature,createdAt:iso(at),status:'Vinculado; aprovação do dono ainda é independente'};state.choiceLinks=[...links,record];return record;
}

function eventTime(v,label,at){const n=instant(v);if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(v)||n>at)throw Error(`${label} inválido ou no futuro.`);return iso(n);}
function eventValue(value,field){const v=value&&typeof value==='object'?value[field]:value;if(field==='dailyBudget'){if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>1e9)throw Error('Valor nativo do orçamento no histórico inválido.');return v;}if(typeof v!=='string'||!['ACTIVE','PAUSED','PROCESSING','PENDING','IN_PROCESS','DELETED','ARCHIVED','ELIMINADO','WITH_ISSUES','DISAPPROVED','CAMPAIGN_PAUSED','ADSET_PAUSED','PENDING_REVIEW','PENDING_BILLING_INFO'].includes(v))throw Error('Status no histórico inválido.');return v;}
function safeActor(v){if(v===null||v===undefined)return null;if(typeof v==='string')return text(v,'Ator',250);if(typeof v==='object'&&!Array.isArray(v)){const out={};for(const k of ['id','key','name','type','kind','profile'])if(v[k]!==undefined&&v[k]!==null)out[k]=text(v[k],'Ator',250);if(Object.keys(out).length)return out;}throw Error('Ator inválido.');}

/** Only complete, paginated Malva observations are accepted; none imply success. */
export function importDecisionHistory(state,args,now=Date.now()){
 const at=instant(now),e=args.entry;if(!e||typeof e!=='object')throw Error('Entrada de histórico obrigatória.');const project=projectOf(state,e.project),from=eventTime(e.from,'Início',at),to=eventTime(e.to,'Fim',at),fetchedAt=eventTime(e.fetchedAt,'Consulta',at);
 if(Date.parse(from)>=Date.parse(to)||Date.parse(fetchedAt)<Date.parse(to))throw Error('Período do histórico inválido.');if(e.complete!==true||e.pagination?.complete!==true||e.pagination.nextCursor!==null)throw Error('Complete todas as páginas do histórico antes de importar.');
 if(!Array.isArray(e.events)||e.events.length>decisionCardLimits.historyPerImport)throw Error('Importe até 500 eventos por entrada.');
 const prior=copy(list(state,'decisionHistory')),imports=list(state,'decisionHistoryImports'),records=[],observations=[],duplicates=[];
 const exact=new Map([...prior,...imports.flatMap(i=>i.observations||[])].map(x=>[x.eventKey,x])),transitions=new Map(prior.map(x=>[x.transitionKey,x]));
 const importFingerprint=seal({project,from,to,fetchedAt,events:e.events}),replay=imports.find(x=>x.fingerprint===importFingerprint);if(replay)return replay;
 for(const raw of e.events){
  if(!raw||typeof raw!=='object')throw Error('Evento de histórico inválido.');
  if(raw.object?.level&&raw.object.level!=='campaign'||raw.account?.provider&&String(raw.account.provider).toLowerCase()!=='meta')throw Error('Histórico de cards aceita apenas campanhas Meta.');
  const eventId=text(raw.eventId??raw.id,'ID do evento',250),objectId=text(raw.externalId??raw.object?.externalId??raw.objectId,'Objeto do evento',250),adAccountId=text(raw.adAccountId??raw.account?.id??raw.account?.accountId,'Conta do evento',250),nativeAccountId=text(raw.nativeAccountId??raw.account?.accountId??raw.adAccountId,'Conta nativa do evento',250),occurredAt=eventTime(raw.occurredAt??raw.at,'Data do evento',at);
  if(Date.parse(occurredAt)<Date.parse(from)||Date.parse(occurredAt)>=Date.parse(to))throw Error('Evento fora do período importado (fim exclusivo).');
  const rawField=raw.field??raw.values?.field??(raw.category==='status'?'status':null),field=rawField==='status'?'status':['dailyBudget','daily_budget','budget'].includes(rawField)?'dailyBudget':null;if(!field)throw Error('Somente orçamento diário e status pertencem a este histórico.');
  const normalizeValue=v=>field==='status'&&typeof v==='string'?v.toUpperCase():v;
  const before=eventValue(normalizeValue(raw.before??raw.values?.from),field),after=eventValue(normalizeValue(raw.after??raw.values?.to),field);if(before===after)throw Error('Evento sem alteração observada.');
  const source=text(raw.source,'Origem do evento',150),actor=safeActor(raw.actor),echo=raw.echo===true||raw.isEcho===true;
  if(raw.echo!==undefined&&raw.echo!==null&&typeof raw.echo!=='boolean'&&(typeof raw.echo!=='object'||Array.isArray(raw.echo)))throw Error('Indicador echo inválido.');
  const nativeEcho=raw.echo&&typeof raw.echo==='object'?{...(raw.echo.at?{at:eventTime(raw.echo.at,'Data do eco',at)}:{}),...(raw.echo.actorName?{actorName:text(raw.echo.actorName,'Ator do eco',250)}:{}),...(raw.echo.app?{app:text(raw.echo.app,'Aplicativo do eco',250)}:{})}:null;
  if(raw.automatic!==undefined&&typeof raw.automatic!=='boolean')throw Error('Indicador de ação automática inválido.');
  const actorKey=typeof actor==='string'?actor:actor?.key??actor?.id??actor?.name??null;
  const eventKey=JSON.stringify([project,eventId]),transitionKey=JSON.stringify([nativeAccountId,objectId,field,before,after,occurredAt,actorKey]);
  const normalized={eventId,project,adAccountId,nativeAccountId,objectId,name:typeof(raw.name??raw.object?.name)==='string'?text(raw.name??raw.object.name,'Nome da campanha',500):null,accountName:typeof(raw.accountName??raw.account?.label)==='string'?text(raw.accountName??raw.account.label,'Nome da conta',500):null,phase:phase(raw.name??raw.object?.name??''),field,before,after,occurredAt,actor,source,echo,nativeEcho,automatic:raw.automatic??null,currency:raw.currency??raw.budgetCurrency??raw.values?.currency??raw.account?.currency??null};
  if(normalized.currency!==null&&!/^[A-Z]{3}$/.test(normalized.currency))throw Error('Moeda do histórico inválida.');
  const digest=seal(normalized),same=exact.get(eventKey),observation={...normalized,eventKey,transitionKey,eventFingerprint:digest};
  if(same){if(same.eventFingerprint!==digest)throw Error('Mesmo ID de evento possui conteúdo divergente.');duplicates.push(eventId);observations.push({...observation,duplicateOf:same.id??same.duplicateOf??null});continue;}
  // Cross-project account links produce different internal UUID/event IDs for
  // the same native action. Preserve each provenance, count that action once.
  let transition=transitions.get(transitionKey);
  if(!transition)transition=[...transitions.values()].find(t=>(echo||t.echo)&&t.nativeAccountId===nativeAccountId&&t.objectId===objectId&&t.field===field&&t.before===before&&t.after===after&&t.occurredAt===occurredAt);
  if(transition){duplicates.push(eventId);transition.projects=[...new Set([...(transition.projects||[transition.project]),project])];transition.originObservations=[...(transition.originObservations||[]),copy(observation)];observations.push({...observation,duplicateOf:transition.id});exact.set(eventKey,{...observation,duplicateOf:transition.id});continue;}
  const action=field==='status'?(before==='ACTIVE'&&after==='PAUSED'?'pause':before==='PAUSED'&&after==='ACTIVE'?'activate':'status'):(after>before?'increase':'reduce'),percent=field==='dailyBudget'&&before>0?Math.abs(after/before-1)*100:null;
  const record={id:crypto.randomUUID(),...observation,projects:[project],originObservations:[copy(observation)],action,percent,observedAt:fetchedAt,sourceSystem:'Malva MCP',financialOutcome:'N/D',causality:'Não demonstrada',preferenceOwner:false,humanObserved:source.toLowerCase()==='malva'&&raw.automatic===false&&typeof actor==='object'&&actor?.kind==='malva'};records.push(record);observations.push(copy(observation));exact.set(eventKey,record);transitions.set(transitionKey,record);
 }
 if(prior.length+records.length>decisionCardLimits.history)throw Error('Limite de 5000 eventos atingido. Exporte o histórico; nenhum evento será apagado.');
 const receipt={id:crypto.randomUUID(),project,from,to,fetchedAt,complete:true,pagination:{complete:true,nextCursor:null},received:e.events.length,inserted:records.length,duplicates:duplicates.length,duplicateEventIds:duplicates,observations,eventIds:records.map(x=>x.id),fingerprint:importFingerprint,createdAt:iso(at),classification:'Observação de alterações; resultado financeiro N/D'};
 state.decisionHistory=[...prior,...records];state.decisionHistoryImports=[...imports,receipt];return receipt;
}

function median(values){if(!values.length)return null;const v=[...values].sort((a,b)=>a-b),m=Math.floor(v.length/2);return v.length%2?v[m]:(v[m-1]+v[m])/2;}
function verifiedOutcome(state,outcome,at){try{const check=copy(state);check.knowledgeOutcomes=[];const verified=recordOutcome(check,{project:outcome.project,objectId:outcome.objectId,adAccountId:outcome.adAccountId,proposalId:outcome.proposalId||undefined,knowledgeId:outcome.knowledgeId||undefined,before:outcome.before,after:outcome.after,sources:outcome.sources,summary:outcome.summary},iso(at));const before=sum([verified.before.metrics]),after=sum([verified.after.metrics]),sameDuration=Date.parse(verified.before.to)-Date.parse(verified.before.from)===Date.parse(verified.after.to)-Date.parse(verified.after.from),classification=sameDuration&&Number.isFinite(before.roi)&&Number.isFinite(after.roi)?after.roi>before.roi?'Favorável':after.roi<before.roi?'Desfavorável':'Inconclusivo':'Inconclusivo';return {...copy(outcome),verified:true,classification,beforeMetrics:before,afterMetrics:after,causality:'Não demonstrada'};}catch{return {...copy(outcome),verified:false,classification:'N/D',limitation:'As fontes ou a aplicação não puderam ser revalidadas na base atual.'};}}
function acquisitionExample(state,record){return !isWarmupCampaign(record.name)&&!isWarmupTarget(state,record.project,'campaign',{adAccountId:record.adAccountId,externalId:record.objectId});}

/** Transparent statistics, not a trained model or an automatic authorization. */
export function decisionLearningPlan(state,project,now=Date.now()){
 const at=instant(now),scope=project&&project!=='all'?projectOf(state,project):null,choices=list(state,'ownerChoices').filter(c=>!scope||c.project===scope).map(c=>linked(state,c,at)),history=list(state,'decisionHistory').filter(e=>!scope||(e.projects||[e.project]).includes(scope)),outcomes=(state.knowledgeOutcomes||[]).filter(o=>!scope||o.project===scope).map(o=>verifiedOutcome(state,o,at));
 const optimizationChoices=choices.filter(c=>acquisitionExample(state,c));
 const pendingChoices=optimizationChoices.filter(c=>c.status==='Pendente de revisão'&&c.proposalStatus!=='Aprovada'&&!list(state,'decisionReopens').some(r=>r.choiceId===c.id)&&choices.filter(x=>x.cardId===c.cardId).at(-1)?.id===c.id),preferences=actions.map(action=>{const rows=optimizationChoices.filter(c=>c.action===action),campaigns=new Set(rows.map(c=>JSON.stringify([c.project,c.adAccountId,c.objectId])));return {action,count:rows.length,independentCampaigns:campaigns.size,medianPercent:campaigns.size>=3?median(rows.filter(c=>Number.isFinite(c.percent)).map(c=>c.percent)):null,observedMedianPercent:median(rows.filter(c=>Number.isFinite(c.percent)).map(c=>c.percent)),confidence:campaigns.size>=20?'Mais observações':campaigns.size>=5?'Amostra inicial':'Insuficiente'};});
 const referenceCases=list(state,'decisionHistory').filter(e=>scope&&!(e.projects||[e.project]).includes(scope)&&acquisitionExample(state,e)).slice(-50).map(e=>({...copy(e),originProject:e.project,referenceOnly:true,financialOutcome:'N/D',policy:'Referência de outro projeto; não altera metas, tetos ou preferência pessoal.'}));
 return {project:scope,reconsiderations:reconsiderationPlan(state,scope),choices:copy(choices),pendingChoices:copy(pendingChoices),preferences,referenceCases,history:copy(history),historyCoverage:copy(list(state,'decisionHistoryImports').filter(i=>!scope||i.project===scope)),outcomes,historicalOutcomes:copy((state.decisionHistoryOutcomes||[]).filter(o=>!scope||o.project===scope)),stats:{choices:choices.length,optimizationChoices:optimizationChoices.length,independentCampaigns:new Set(choices.map(c=>JSON.stringify([c.project,c.adAccountId,c.objectId]))).size,pendingChoices:pendingChoices.length,observedHistory:history.length,verifiedOutcomes:outcomes.filter(o=>o.verified).length,agreementCount:optimizationChoices.filter(c=>c.suggestionOrigin!=='diagnostic'&&c.action===c.suggestedAction&&(c.percent===null&&c.suggestedPercent===null||Number.isFinite(c.percent)&&Number.isFinite(c.suggestedPercent)&&Math.abs(c.percent-c.suggestedPercent)<0.0001)).length},maturity:{stage:'Copiloto com aprovação',automaticExecutionEnabled:false,promotedAutomatically:false},policy:'Preferência observada não comprova resultado. Histórico de terceiros é referência, não meta nem autorização. Aprendizados nunca alteram limites ou habilitam execução automática.'};
}
