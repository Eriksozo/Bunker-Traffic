/** Production metadata can explain identity; it cannot create ad performance. */
const arr=x=>Array.isArray(x)?x:[],time=x=>Date.parse(x||'');
const name=x=>typeof x==='string'?x.trim().normalize('NFC'):'';
export function creativeLearningContext(state,project,data,focus=[],now=Date.now()){
 const matches=arr(data?.items).filter(x=>x.projectId===project),item=matches.length===1?matches[0]:null,s=item?.snapshot;
 const identity=s?.source==='Órbita MCP'&&s.projectId===project&&s.projectName===state.config?.[project]?.projectName;
 const fresh=identity&&!item.error&&!data?.error&&Number.isFinite(time(s.fetchedAt))&&time(s.fetchedAt)<=now&&now-time(s.fetchedAt)<=600000;
 if(!fresh)return {source:'Órbita MCP',available:false,fetchedAt:identity?s.fetchedAt:null,reason:identity?'Metadados antigos ou com falha: não representam uma consulta atual à Órbita.':'Sem metadados Órbita conciliados para este projeto.',matches:[],coverage:'returned-items-only',financialEvidence:false};
 const campaigns=new Set(focus.map(r=>JSON.stringify([r.adAccountId,r.externalId]))),adNames=new Set(arr(state.snapshots).filter(c=>c.projectId===project&&c.level==='ad').flatMap(c=>arr(c.rows)).filter(r=>campaigns.has(JSON.stringify([r.adAccountId,r.campaignExternalId]))).map(r=>name(r.name)).filter(Boolean));
 const rows=arr(s.rows).filter(r=>r.expert===s.binding?.expertSigla&&[r.name,r.metaName].some(n=>adNames.has(name(n))));
 const byName=new Map();for(const r of rows){const key=name(r.metaName||r.name);if(!byName.has(key))byName.set(key,[]);byName.get(key).push(r);}
 const resolved=[...byName.values()].filter(g=>g.length===1).map(([r])=>({id:r.id,kind:r.kind,name:r.name,metaName:r.metaName||null,status:r.status,origin:typeof r.origin==='string'?r.origin:null,sourceUpdatedAt:r.sourceUpdatedAt??null}));
 return {source:'Órbita MCP',available:true,fetchedAt:s.fetchedAt,binding:{squad:s.binding?.squad,expertId:s.binding?.expertId,expertSigla:s.binding?.expertSigla},matches:resolved.slice(0,12),ambiguousNames:[...byName.values()].filter(g=>g.length>1).length,omittedMatches:Math.max(0,resolved.length-12),coverage:'returned-items-only',financialEvidence:false,rule:'Vínculo por nomenclatura exata; sufixos de Avatar ou limpeza não são removidos por suposição. Status de produção não comprova venda, entrega Meta nem validação econômica.'};
}
