const own=(o,k)=>Object.hasOwn(o||{},k),bytes=o=>new TextEncoder().encode(JSON.stringify(o)).length;
const absent={absent:true};
/** A lossless table: null and absent are distinct, and every original primitive is retained. */
export function columnarSeries(rows){
 if(!Array.isArray(rows)||rows.length<2||rows.some(r=>!r||Array.isArray(r)||typeof r!=='object'||Object.values(r).some(v=>v===undefined||['bigint','function','symbol'].includes(typeof v)||typeof v==='number'&&!Number.isFinite(v)||v&&typeof v==='object'&&v.absent===true)))return rows;
 const all=[...new Set(rows.flatMap(Object.keys))],fixed=all.filter(k=>rows.every(r=>own(r,k)&&JSON.stringify(r[k])===JSON.stringify(rows[0][k]))),constants=Object.fromEntries(fixed.map(k=>[k,rows[0][k]])),columns=all.filter(k=>!fixed.includes(k)),table={encoding:'columns/v1',columns,...(fixed.length?{constants}:{}),rows:rows.map(r=>columns.map(k=>own(r,k)?r[k]:absent))};
 return bytes(table)<bytes(rows)?table:rows;
}
/** Remove only exact duplicate metadata. Numeric observations stay on every campaign window and child row. */
export function economizeCloudPacket(context){
 let changed=false;
 for(const c of context.campaigns||[]){
  for(const window of Object.values(c.windows||{}))if(window){
   const shared=[];for(const k of ['id','name','level','provider','accountName','budgetCurrency','campaignExternalId','adsetExternalId'])if(own(window,k)&&own(c.target,k)&&JSON.stringify(window[k])===JSON.stringify(c.target[k])){delete window[k];shared.push(k);}
   if(shared.length){window.metadataFromTarget=[...new Set([...(window.metadataFromTarget||[]),...shared])];changed=true;}
   if(window.calculated){const reused=[];for(const k of Object.keys(window.calculated))if(own(window,k)&&window.calculated[k]===window[k]){delete window.calculated[k];reused.push(k);}if(reused.length){window.calculatedUsesRaw=[...new Set([...(window.calculatedUsesRaw||[]),...reused])];changed=true;}}
  }
  const groups=new Map();for(const h of c.hierarchy||[])for(const row of h.rows||[]){const key=JSON.stringify([row.adAccountId,row.externalId]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
  const identities=[];
  for(const rows of groups.values()){
   if(rows.length<2)continue;const metadata={};
   for(const k of ['id','name','level','provider','accountName','budgetCurrency','campaignExternalId','adsetExternalId'])if(own(rows[0],k)&&rows.every(r=>own(r,k)&&JSON.stringify(r[k])===JSON.stringify(rows[0][k]))){metadata[k]=rows[0][k];for(const r of rows)delete r[k];}
   if(Object.keys(metadata).length){identities.push({adAccountId:rows[0].adAccountId,externalId:rows[0].externalId,metadata});changed=true;}
  }
  if(identities.length)c.sharedChildMetadata=[...(c.sharedChildMetadata||[]),...identities];
 }
 for(const r of context.research?.details||[]){
  const detail=r.detail;if(!detail||typeof detail!=='object')continue;
  for(const [owner,k] of [[detail,'daily'],[detail.intraday,'hourly']])if(owner&&Array.isArray(owner[k])){const compact=columnarSeries(owner[k]);if(compact!==owner[k]){owner[k]=compact;changed=true;}}
 }
 if(changed){context.coverage||={};context.coverage.losslessEncoding={version:1,rule:'metadataFromTarget herda somente os campos listados do target da própria campanha. sharedChildMetadata identifica filhos por adAccountId/externalId; seus campos comuns foram removidos das linhas repetidas. calculatedUsesRaw aponta valores já presentes na mesma janela. Séries columns/v1 mantêm todos os dias/horas e valores pela ordem columns; {absent:true} é campo ausente, diferente de null e zero. Nenhum número foi arredondado ou estimado.'};}
 return context;
}

/** Transport-only tables. Validation still sees the original named numeric fields. */
export function modelPacketView(context){
 let changed=false;
 const campaigns=(context.campaigns||[]).map(c=>({...c,hierarchy:(c.hierarchy||[]).map(h=>{const rows=columnarSeries(h.rows);if(rows!==h.rows)changed=true;return {...h,rows};})}));
 const research=context.research?{...context.research,details:(context.research.details||[]).map(r=>{if(!r.history)return r;const items=columnarSeries(r.history.items);if(items!==r.history.items)changed=true;return {...r,history:{...r.history,items}};})}:context.research;
 if(!changed)return poolColumns(context);
 const view={...context,campaigns,...(research?{research}:{}),coverage:{...context.coverage,losslessEncoding:{...context.coverage?.losslessEncoding,version:1,tableRule:'Hierarquia.rows e history.items também podem usar columns/v1. Cada célula corresponde ao nome na posição de columns; constants contém campos iguais em todas as linhas. Objetos e números foram preservados. {absent:true} é N/D, nunca zero. As citações continuam com os nomes canônicos das métricas.'}}};
 return poolColumns(view);
}

function poolColumns(input){
 const view=structuredClone(input);
 const tables=[];const visit=value=>{if(!value||typeof value!=='object')return;if(value.encoding==='columns/v1'&&Array.isArray(value.columns)){tables.push(value);return;}for(const child of Object.values(value))visit(child);};visit(view);
 const groups=new Map();for(const table of tables){const key=JSON.stringify(table.columns);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(table);}
 const columns={};let i=0;for(const [serialized,items] of groups){if(items.length<2||serialized.length*(items.length-1)<items.length*30+40)continue;const id='s'+i++;columns[id]=items[0].columns;for(const table of items){table.columnSet=id;delete table.columns;}}
 if(i){view.coverage={...view.coverage,sharedTableColumns:columns,losslessEncoding:{...view.coverage.losslessEncoding,columnSetRule:'Quando columns foi compartilhado, columnSet aponta para coverage.sharedTableColumns. A ordem das colunas e todos os valores continuam exatos.'}};}return poolText(view);
}

function poolText(view){
 const refs=new Map(),walk=value=>{if(!value||typeof value!=='object')return;for(const [key,child] of Object.entries(value)){if(['name','accountName','projectName'].includes(key)&&typeof child==='string'&&child.length>60){if(!refs.has(child))refs.set(child,[]);refs.get(child).push([value,key]);}else if(child&&typeof child==='object')walk(child);}};walk(view);
 const shared={};let i=0;for(const [text,places] of refs){if(places.length<2||text.length*(places.length-1)<places.length*25+60)continue;const id='t'+i++;shared[id]=text;for(const [object,key] of places)object[key]={sharedText:id};}
 if(i)view.coverage={...view.coverage,sharedTexts:shared,losslessEncoding:{...view.coverage?.losslessEncoding,sharedTextRule:'Em name/accountName/projectName, {sharedText:id} aponta para coverage.sharedTexts[id]. O texto é idêntico ao original; IDs de conta e campanha não foram substituídos.'}};return view;
}
