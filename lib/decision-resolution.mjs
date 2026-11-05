/** Compact, immutable receipts for choices whose verified executions are archived.
 * No choice, proposal, authorization or execution is changed by this module.
 */
const list=(state,key)=>Array.isArray(state[key])?state[key]:[];
const validTime=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const text=value=>typeof value==='string'&&value.length>0;
function proposalId(state,choice){return list(state,'choiceLinks').find(link=>link.choiceId===choice.id)?.proposalId||choice.proposalId;}
function sameChoice(choice,proposal){
 const p=proposal.payload;
 if(choice.proposalVersion!==undefined&&(choice.proposalVersion!==proposal.version||choice.proposalSignature!==proposal.signature))return false;
 if(choice.project!==proposal.project||p?.level!=='campaign'||!p.before||!p.after||choice.objectId!==p.objectId||choice.adAccountId!==p.adAccountId||choice.currency!==p.currency)return false;
 if(choice.action==='pause')return p.action==='status'&&choice.before?.status===p.before.status&&choice.after?.status===p.after.status;
 return ['increase','reduce'].includes(choice.action)&&p.action==='budget'&&choice.before?.dailyBudget===p.before.dailyBudget&&choice.after?.dailyBudget===p.after.dailyBudget;
}
function confirmed(proposal,execution,now){
 const p=proposal?.payload,r=execution?.readback,observed=r?.row;
 if(!p?.before||!p.after||!text(proposal.id)||!text(proposal.signature)||!Number.isInteger(proposal.version)||proposal.version<1||!text(execution?.id))return false;
 if(proposal.status!=='Aprovada'||proposal.approvedVersion!==proposal.version||proposal.approvedSignature!==proposal.signature||execution.status!=='Confirmada'||execution.proposalId!==proposal.id||execution.project!==proposal.project||execution.proposalVersion!==proposal.version||execution.proposalSignature!==proposal.signature)return false;
 if(!validTime(execution.confirmedAt)||Date.parse(execution.confirmedAt)>now||!validTime(execution.submittedAt)||Date.parse(execution.submittedAt)>Date.parse(execution.confirmedAt)||!validTime(r?.fetchedAt)||Date.parse(r.fetchedAt)<Date.parse(execution.submittedAt)||Date.parse(r.fetchedAt)>Date.parse(execution.confirmedAt)||proposal.executionConfirmedAt!==execution.confirmedAt)return false;
 if(r.source!=='Malva MCP'||r.complete!==true||r.projectId!==proposal.project||r.level!==p.level||!observed||!text(observed.id)||observed.id!==execution.preflight?.row?.id||observed.externalId!==p.objectId||observed.adAccountId!==p.adAccountId||observed.provider!==p.provider||observed.budgetCurrency!==p.currency)return false;
 return p.action==='budget'?observed.dailyBudget===p.after.dailyBudget:p.action==='status'&&observed.status===p.after.status;
}
/** A displayed status alone is not a verified application of this choice. */
export function readLiveChoiceResolution(state,choice,now=Date.now()){
 if(!choice)return null;
 const proposal=list(state,'proposals').find(p=>p.id===proposalId(state,choice)&&p.project===choice.project&&sameChoice(choice,p));
 if(!proposal)return null;
 return list(state,'executions').find(e=>confirmed(proposal,e,now))||null;
}
export function retainChoiceResolutions(state,archives,now=Date.now()){
 const receipts=[...list(state,'choiceResolutions')];
 for(const archive of archives){
  if(!text(archive.key)||!archive.key.startsWith('collaboration:'))continue;
  for(const proposal of list(archive.payload||{},'proposals')){
   const execution=list(archive.payload||{},'executions').find(e=>confirmed(proposal,e,now));
   if(!execution)continue;
   for(const choice of list(state,'ownerChoices')){
    if(proposalId(state,choice)!==proposal.id||!sameChoice(choice,proposal)||receipts.some(r=>r.choiceId===choice.id))continue;
    receipts.push({choiceId:choice.id,project:choice.project,objectId:choice.objectId,adAccountId:choice.adAccountId,proposalId:proposal.id,proposalVersion:proposal.version,proposalSignature:proposal.signature,executionId:execution.id,status:'Confirmada',confirmedAt:execution.confirmedAt,archiveKey:archive.key});
   }
  }
 }
 if(receipts.length)state.choiceResolutions=receipts;
}
export function readChoiceResolution(state,choice,now=Date.now()){
 return list(state,'choiceResolutions').find(r=>r.choiceId===choice.id&&r.project===choice.project&&r.objectId===choice.objectId&&r.adAccountId===choice.adAccountId&&r.proposalId===proposalId(state,choice)&&text(r.executionId)&&text(r.proposalSignature)&&Number.isInteger(r.proposalVersion)&&r.proposalVersion>0&&text(r.archiveKey)&&r.archiveKey.startsWith('collaboration:')&&r.status==='Confirmada'&&(choice.proposalVersion===undefined||r.proposalVersion===choice.proposalVersion&&r.proposalSignature===choice.proposalSignature)&&validTime(r.confirmedAt)&&Date.parse(r.confirmedAt)<=now)||null;
}

/** Read old archives by exact linked proposal only. Never transfer source journals to central. */
export function choiceResolutionArchiveQuery(state,now=Date.now()){
 const requests=list(state,'ownerChoices').filter(c=>['increase','reduce','pause'].includes(c.action)&&!readChoiceResolution(state,c,now)).map(c=>({project:c.project,proposalId:proposalId(state,c)})).filter(r=>text(r.project)&&text(r.proposalId)&&!list(state,'proposals').some(p=>p.id===r.proposalId&&p.project===r.project)).slice(0,500);
 const unique=[...new Map(requests.map(r=>[JSON.stringify(r),r])).values()];
 if(!unique.length)return null;
 const sql=`WITH requested AS (
  SELECT json_extract(value,'$.project') AS project,json_extract(value,'$.proposalId') AS proposal_id FROM json_each(?)
 ) SELECT a.key AS archive_key,
 json_object('id',json_extract(p.value,'$.id'),'project',json_extract(p.value,'$.project'),
  'status',json_extract(p.value,'$.status'),'version',json_extract(p.value,'$.version'),'signature',json_extract(p.value,'$.signature'),
  'approvedVersion',json_extract(p.value,'$.approvedVersion'),'approvedSignature',json_extract(p.value,'$.approvedSignature'),
  'executionConfirmedAt',json_extract(p.value,'$.executionConfirmedAt'),
  'payload',json_object('action',json_extract(p.value,'$.payload.action'),'level',json_extract(p.value,'$.payload.level'),
   'provider',json_extract(p.value,'$.payload.provider'),'adAccountId',json_extract(p.value,'$.payload.adAccountId'),
   'objectId',json_extract(p.value,'$.payload.objectId'),'currency',json_extract(p.value,'$.payload.currency'),
   'before',json_object('dailyBudget',json_extract(p.value,'$.payload.before.dailyBudget'),'status',json_extract(p.value,'$.payload.before.status')),
   'after',json_object('dailyBudget',json_extract(p.value,'$.payload.after.dailyBudget'),'status',json_extract(p.value,'$.payload.after.status')))) AS proposal,
 json_object('id',json_extract(e.value,'$.id'),'proposalId',json_extract(e.value,'$.proposalId'),'project',json_extract(e.value,'$.project'),
  'proposalVersion',json_extract(e.value,'$.proposalVersion'),'proposalSignature',json_extract(e.value,'$.proposalSignature'),
  'status',json_extract(e.value,'$.status'),'confirmedAt',json_extract(e.value,'$.confirmedAt'),'submittedAt',json_extract(e.value,'$.submittedAt'),
  'preflight',json_object('row',json_object('id',json_extract(e.value,'$.preflight.row.id'))),
  'readback',json_object('source',json_extract(e.value,'$.readback.source'),
   'complete',json(CASE WHEN json_type(e.value,'$.readback.complete')='true' THEN 'true' ELSE 'false' END),
   'projectId',json_extract(e.value,'$.readback.projectId'),'level',json_extract(e.value,'$.readback.level'),'fetchedAt',json_extract(e.value,'$.readback.fetchedAt'),
   'row',json_object('id',json_extract(e.value,'$.readback.row.id'),'externalId',json_extract(e.value,'$.readback.row.externalId'),
    'adAccountId',json_extract(e.value,'$.readback.row.adAccountId'),'provider',json_extract(e.value,'$.readback.row.provider'),
    'budgetCurrency',json_extract(e.value,'$.readback.row.budgetCurrency'),'dailyBudget',json_extract(e.value,'$.readback.row.dailyBudget'),'status',json_extract(e.value,'$.readback.row.status')))) AS execution
 FROM bunker_records a JOIN requested r ON json_extract(a.payload,'$.round.project')=r.project
 JOIN json_each(a.payload,'$.proposals') p ON json_extract(p.value,'$.id')=r.proposal_id AND json_extract(p.value,'$.project')=r.project
 JOIN json_each(a.payload,'$.executions') e ON json_extract(e.value,'$.proposalId')=r.proposal_id AND json_extract(e.value,'$.project')=r.project
 WHERE a.key GLOB 'collaboration:*' AND json_extract(a.payload,'$.type')='bunker-collaboration'
 AND json_extract(a.payload,'$.version')=1 AND json_extract(p.value,'$.status')='Aprovada' AND json_extract(e.value,'$.status')='Confirmada'
 ORDER BY a.key,json_extract(e.value,'$.id') LIMIT ?`;
 return {sql,params:[JSON.stringify(unique),500],requested:unique.length};
}

/** Adds derived receipts in memory only; D1 archives and original choices stay immutable. */
export async function hydrateChoiceResolutions(db,state,now=Date.now()){
 const query=choiceResolutionArchiveQuery(state,now);if(!query)return {requested:0,recovered:0};
 const result=await db.prepare(query.sql).bind(...query.params).all();
 if(result.success===false||!Array.isArray(result.results))throw Error('Não foi possível conferir os recibos arquivados das decisões.');
 const before=list(state,'choiceResolutions').length;
 const archives=result.results.map(row=>({key:row.archive_key,payload:{proposals:[JSON.parse(row.proposal)],executions:[JSON.parse(row.execution)]}}));
 retainChoiceResolutions(state,archives,now);
 return {requested:query.requested,recovered:list(state,'choiceResolutions').length-before};
}
