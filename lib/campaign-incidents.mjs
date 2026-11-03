import {z} from 'zod';

/** Owner declarations are context for analysis, never evidence that a checkout
 * recovered or authorization to change an advertisement. */
export const incidentLimits=Object.freeze({incidents:500,history:250,accounts:500,objects:1000});
const identifier=z.string().trim().min(1).max(2500);
const status=z.enum(['Interrompido','Em retomada','Encerrado']);
const scopeSchema=z.object({
 accountIds:z.array(identifier).max(incidentLimits.accounts),
 objectIds:z.array(z.object({adAccountId:identifier,objectId:identifier}).strict()).max(incidentLimits.objects),
}).strict().superRefine((scope,ctx)=>{
 if(new Set(scope.accountIds).size!==scope.accountIds.length)ctx.addIssue({code:z.ZodIssueCode.custom,message:'Conta duplicada no escopo.'});
 if(new Set(scope.objectIds.map(row=>JSON.stringify([row.adAccountId,row.objectId]))).size!==scope.objectIds.length)ctx.addIssue({code:z.ZodIssueCode.custom,message:'Campanha duplicada no escopo.'});
 if(scope.accountIds.length&&scope.objectIds.some(row=>!scope.accountIds.includes(row.adAccountId)))ctx.addIssue({code:z.ZodIssueCode.custom,message:'Campanha fora das contas indicadas no escopo.'});
});
const common={project:identifier,status,note:z.string().trim().min(1).max(2500),clientId:z.string().trim().min(1).max(150),revision:z.number().int().nonnegative().optional()};
const request=z.discriminatedUnion('op',[
 z.object({...common,op:z.literal('incidentReport'),kind:z.enum(['checkout','tracking','delivery','other']),scope:scopeSchema}).strict(),
 z.object({...common,op:z.literal('incidentUpdate'),id:identifier}).strict(),
]);
function canonical(value){if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';return JSON.stringify(value);}
function fingerprint(value){const source=canonical(value);let a=2166136261,b=3335557771;for(let i=0;i<source.length;i++){a=Math.imul(a^source.charCodeAt(i),16777619);b=Math.imul(b^source.charCodeAt(i),2246822519);}return 'v1-'+(a>>>0).toString(16).padStart(8,'0')+(b>>>0).toString(16).padStart(8,'0');}
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value||{},key);

export function recordIncident(state,input,ownerId,now=Date.now()){
 const owner=z.string().trim().min(1).max(250).parse(ownerId),args=request.parse(input),at=typeof now==='number'?now:Date.parse(now);
 if(!Number.isFinite(at))throw Error('Horário da comunicação inválido.');
 if(!own(state.config,args.project))throw Error('Projeto não configurado.');
 const incidents=state.incidents===undefined?[]:state.incidents;
 if(!Array.isArray(incidents))throw Error('Histórico de incidentes inválido.');
 const {revision,...payload}=args,digest=fingerprint({...payload,ownerId:owner});
 for(const incident of incidents){
  if(!Array.isArray(incident.history))throw Error('Histórico de incidentes inválido.');
  const replay=incident.history.find(entry=>entry.clientId===args.clientId);
  if(replay){if(replay.fingerprint!==digest||replay.ownerId!==owner||incident.project!==args.project)throw Error('Identificador já usado por outra comunicação.');return incident;}
 }
 const reportedAt=new Date(at).toISOString(),entry={status:args.status,note:args.note,reportedAt,ownerId:owner,clientId:args.clientId,fingerprint:digest};
 let record;
 if(args.op==='incidentReport'){
  if(incidents.length>=incidentLimits.incidents)throw Error('Limite de incidentes atingido. Exporte o histórico; nenhum registro foi apagado.');
  record={id:crypto.randomUUID(),project:args.project,kind:args.kind,status:args.status,note:args.note,scope:structuredClone(args.scope),reportedAt,ownerId:owner,createdAt:reportedAt,updatedAt:reportedAt,history:[entry]};
  state.incidents=[...incidents,record];
 }else{
  const index=incidents.findIndex(incident=>incident.id===args.id&&incident.project===args.project);
  if(index===-1)throw Error('Incidente não encontrado neste projeto.');
  const previous=incidents[index];
  if(previous.history.length>=incidentLimits.history)throw Error('Limite de comunicações deste incidente atingido. Exporte o histórico; nenhum registro foi apagado.');
  if(!Number.isFinite(Date.parse(previous.reportedAt))||at<Date.parse(previous.reportedAt))throw Error('A comunicação não pode anteceder o último registro do incidente.');
  record={...previous,status:args.status,note:args.note,reportedAt,updatedAt:reportedAt,ownerId:owner,history:[...previous.history,entry]};
  state.incidents=incidents.map((incident,i)=>i===index?record:incident);
 }
 return record;
}
