import {recordKnowledge,recordOutcome} from '../../lib/knowledge.mjs';
import {ensureCollaboration} from '../../lib/collaboration.mjs';
export const learningNow=Date.parse('2026-11-05T12:00:00Z');
const now=learningNow,iso=n=>new Date(n).toISOString(),day=86400000;
export function learningFixture(n=5){
 const state={config:{p:{projectName:'John'},q:{projectName:'Nico'}},snapshots:[],decisions:[],jobs:[],events:[],ownerChoices:[],knowledge:[],agents:{},messages:[],reports:[],tasks:[],paused:false,cadence:{enabled:false,intervalMinutes:15,start:'06:00',end:'20:00',weekdays:[0,1,2,3,4,5,6],timezone:'UTC'}};
 const registered='2026-10-20T00:00:00.000Z',knowledge=recordKnowledge(state,{project:'p',topic:'Hipótese de contenção',claim:'Comparar aquisição e resultado depois de conter exposição.',confidence:0.4,sources:[{system:'Malva MCP',reference:'initial',observedAt:registered,summary:'Hipótese observada antes dos testes.'}]},registered);
 for(let i=0;i<n;i++){
  const t=Date.parse('2026-10-23T00:00:00Z')+i*day,objectId='case'+i,adAccountId='account'+i,metrics={spend:100,revenueNet:150,adCosts:0,productCost:0,saleTax:0,frontOrders:2};
  const cuts=[{from:iso(t),to:iso(t+day),metrics},{from:iso(t+2*day),to:iso(t+3*day),metrics:{...metrics,revenueNet:220,frontOrders:3}}];
  const sources=cuts.map((c,j)=>{state.snapshots.push({projectId:'p',level:'campaign',source:'Malva MCP',complete:true,timezone:'UTC',fetchedAt:iso(now-1000),lastSyncAt:iso(now-1000),from:c.from,to:c.to,rows:[{externalId:objectId,adAccountId,provider:'meta',name:'Sales',...c.metrics}]});return {system:'Malva MCP',reference:'cut'+i+'-'+j,observedAt:iso(now-1000),from:c.from,to:c.to,summary:'Métricas verificáveis.'};});
  const proposalId='applied'+i;state.decisions.push({id:proposalId,project:'p',objectId,adAccountId,status:'Aplicada pelo operador',appliedAt:iso(t+36*3600000)});
  recordOutcome(state,{project:'p',objectId,adAccountId,proposalId,knowledgeId:knowledge.id,before:cuts[0],after:cuts[1],sources,summary:'Comparação observada, sem causalidade.'},iso(now));
 }
 const start=Date.parse('2026-11-05T00:00:00Z');
 for(const [period,from,to] of [['7d',start-7*day,start],['3d',start-3*day,start],['yesterday',start-day,start],['today',start,start+day]])state.snapshots.push({projectId:'p',period,level:'campaign',source:'Malva MCP',complete:true,timezone:'UTC',fetchedAt:iso(now-1000),lastSyncAt:iso(now-1000),from:iso(from),to:iso(to),rows:[{externalId:'current',adAccountId:'local',provider:'meta',name:'Sales',status:'ACTIVE',spend:50,revenueNet:70,frontOrders:1}]});
 const job={id:'job',project:'p',status:'Concluída',startedAt:iso(now-60000),completedAt:iso(now-500)};state.jobs.push(job);const round=ensureCollaboration(state,job,now);
 return {state,knowledge,round};
}
