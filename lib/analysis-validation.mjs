import {bundleSchema,validTimeZone} from './snapshot-schema.mjs';
const at=v=>Date.parse(v||''),key=s=>JSON.stringify([s.projectId,s.period,s.level]);
/** Validate the entire incoming batch before callers mutate any journal. Old
 * persisted records remain readable; new writes cannot hide foreign metadata
 * by dropping unknown fields during schema normalization. */
export function validateAnalysisBundle(input,state,now=Date.now()){
 const parsed=bundleSchema.parse(input),seen=new Set();
 for(let i=0;i<parsed.snapshots.length;i++){
  const s=parsed.snapshots[i],raw=input.snapshots[i],k=key(s);
  if(seen.has(k))throw Error('Janela duplicada no mesmo lote de análise.');seen.add(k);
  if(!s.projectId.trim()||!s.projectName.trim())throw Error('Identidade do projeto vazia.');
  if(s.coverage)throw Error('O recorte de acompanhamento não pode substituir as fontes completas de análise.');
  if(at(s.fetchedAt)>now+300000||s.lastSyncAt!==null&&at(s.lastSyncAt)>at(s.fetchedAt))throw Error('Data de consulta ou sincronização no futuro.');
  const previous=(state.snapshots||[]).find(p=>key(p)===k);
  if(previous&&at(s.fetchedAt)<at(previous.fetchedAt))throw Error('Leitura anterior à base salva. Consulte novamente o Malva.');
  if(previous&&s.fetchedAt===previous.fetchedAt&&JSON.stringify(previous)!==JSON.stringify(s))throw Error('A mesma data de consulta possui conteúdo diferente.');
  const ids=new Set();
  for(let j=0;j<s.rows.length;j++){
   const r=s.rows[j],original=raw.rows[j],id=JSON.stringify([r.adAccountId,r.externalId]);
   if(!r.externalId.trim()||!r.adAccountId.trim()||r.level!==s.level||original.projectId!==undefined&&original.projectId!==s.projectId||original.projectName!==undefined&&original.projectName!==s.projectName)throw Error('Linha com identidade, projeto ou nível incompatíveis com a janela.');
   if(ids.has(id))throw Error('Objeto duplicado na mesma janela.');ids.add(id);
  }
 }
 return parsed;
}
function civil(instant,tz){const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(instant)).map(p=>[p.type,p.value]));return {...p,day:`${p.year}-${p.month}-${p.day}`};}
/** A current native write cannot inherit a 24h proposal's stale analytics.
 * Confirmation of an already sent command is deliberately exempt at callers. */
export function assertFinancialSources(cuts,now=Date.now()){
 const campaign=(cuts||[]).filter(c=>c.level==='campaign'),windows=new Map();
 for(const period of ['7d','3d','yesterday','today']){
  const matches=campaign.filter(c=>c.period===period);if(matches.length!==1)throw Error('Execução exige quatro janelas de campanha únicas.');
  const c=matches[0];if(c.source!=='Malva MCP'||c.complete!==true||!Number.isFinite(at(c.fetchedAt))||at(c.fetchedAt)>now||now-at(c.fetchedAt)>3600000)throw Error('Análise vencida ou incompleta antes da execução. Releia os quatro períodos.');
  if(!validTimeZone(c.timezone)||!Number.isFinite(at(c.from))||!Number.isFinite(at(c.to))||at(c.from)>=at(c.to))throw Error('Período ou fuso inválido na fonte financeira.');
  const from=civil(at(c.from),c.timezone),to=civil(at(c.to),c.timezone),days=(at(to.day+'T00:00:00Z')-at(from.day+'T00:00:00Z'))/86400000;
  if([from,to].some(p=>p.hour!=='00'||p.minute!=='00'||p.second!=='00')||days!==({ '7d':7,'3d':3,yesterday:1,today:1 })[period])throw Error('Janelas financeiras precisam de dias completos e fronteiras no fuso do projeto.');
  windows.set(period,c);
 }
 const today=windows.get('today');
 if(!(at(today.from)<=now&&now<at(today.to)))throw Error('O dia mudou desde a aprovação. Nova análise e aprovação são necessárias.');
 for(const period of ['7d','3d','yesterday']){const c=windows.get(period);if(c.timezone!==today.timezone||at(c.to)!==at(today.from))throw Error('As janelas fechadas não terminam no início do dia atual.');}
}
