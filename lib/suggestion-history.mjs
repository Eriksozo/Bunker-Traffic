/** Immutable suggestion journals. These contain original authored records only;
 * an absent collaboration is never reconstructed from a suggestion. */
const clone=value=>JSON.parse(JSON.stringify(value));
const label=value=>typeof value==='string'&&value.length>0&&value.length<=250;
const receipts=s=>[...(s.batchReceipt?[s.batchReceipt]:[]),...(Array.isArray(s.batchReceipts)?s.batchReceipts:[])];

/** Caller must commit the returned central state and journals in one CAS transaction. */
export function compactOrphanSuggestions(state,now=Date.now()){
 const suggestions=state.cardSuggestions||[];
 if(!Array.isArray(suggestions))throw Error('Arquivo de sugestões inválido.');
 const roundIds=new Set((state.collaborationRounds||[]).map(r=>r.id)),counts=new Map(),byId=new Map();
 for(const s of suggestions){counts.set(s.id,(counts.get(s.id)||0)+1);byId.set(s.id,s);}
 const candidates=new Set(suggestions.filter(s=>label(s.id)&&label(s.project)&&label(s.roundId)&&(s.batchReceipts===undefined||Array.isArray(s.batchReceipts))&&(s.requestAliases===undefined||Array.isArray(s.requestAliases))&&Object.prototype.hasOwnProperty.call(state.config||{},s.project)&&!roundIds.has(s.roundId)&&counts.get(s.id)===1).map(s=>s.id));
 // Keep a connected batch central if any member is missing, ambiguous, retained,
 // or from another project/round. Do not split or rewrite its receipts/aliases.
 let changed;
 do{
  changed=false;
  for(const s of suggestions)for(const r of receipts(s)){
   const ids=[s.id,...(Array.isArray(r?.recordIds)?r.recordIds:[])];
   const intact=Array.isArray(r?.recordIds)&&r.recordIds.length>0&&new Set(r.recordIds).size===r.recordIds.length&&r.recordIds.includes(s.id)&&ids.every(id=>candidates.has(id)&&byId.get(id)?.project===s.project&&byId.get(id)?.roundId===s.roundId);
   if(!intact)for(const id of ids)if(candidates.delete(id))changed=true;
  }
 }while(changed);
 const groups=new Map();
 for(const s of suggestions)if(candidates.has(s.id)){const key=JSON.stringify([s.project,s.roundId]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(s);}
 const archivedAt=new Date(now).toISOString(),archives=[...groups.values()].map(items=>({
  key:'suggestions:'+globalThis.crypto.randomUUID(),immutableNew:true,
  payload:{type:'bunker-suggestions',version:1,project:items[0].project,roundId:items[0].roundId,archivedAt,cardSuggestions:clone(items)}
 }));
 if(state.cardSuggestions)state.cardSuggestions=suggestions.filter(s=>!candidates.has(s.id));
 return {state,archives};
}

function cursorEncode(value){return btoa(Array.from(new TextEncoder().encode(JSON.stringify(value)),b=>String.fromCharCode(b)).join('')).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');}
function cursorDecode(cursor,project){
 if(!cursor)return null;
 try{
  if(typeof cursor!=='string'||cursor.length>2000||!/^[A-Za-z0-9_-]+$/.test(cursor))throw Error();
  const raw=atob(cursor.replaceAll('-','+').replaceAll('_','/')),v=JSON.parse(new TextDecoder().decode(Uint8Array.from(raw,c=>c.charCodeAt(0))));
  if(!Array.isArray(v)||v.length!==3||v[0]!==project||typeof v[1]!=='string'||!Number.isFinite(Date.parse(v[1]))||typeof v[2]!=='string'||v[2].length>500||! /^(suggestions|collaboration):.+$/.test(v[2]))throw Error();
  return {at:v[1],key:v[2]};
 }catch{throw Error('Cursor de sugestões inválido para este projeto.');}
}
/** @param {string} project @param {number} limit @param {string|null} cursor */
export function suggestionHistoryQuery(project,limit=10,cursor=null){
 if(!label(project)||project==='all')throw Error('Informe um projeto válido.');
 if(!Number.isInteger(limit)||limit<1||limit>20)throw Error('Limite de históricos de sugestões inválido.');
 const after=cursorDecode(cursor,project),params=[project,project];
 let position='';if(after){position=' AND (updated_at < ? OR (updated_at = ? AND key < ?))';params.push(after.at,after.at,after.key);}
 params.push(limit+1);
 return {project,limit,params,sql:`SELECT key,payload,updated_at FROM bunker_records WHERE (
  (key GLOB 'suggestions:*' AND json_extract(payload,'$.type')='bunker-suggestions' AND json_extract(payload,'$.version')=1 AND json_extract(payload,'$.project')=?)
  OR (key GLOB 'collaboration:*' AND json_extract(payload,'$.type')='bunker-collaboration' AND json_extract(payload,'$.version')=1 AND json_extract(payload,'$.round.project')=? AND json_array_length(payload,'$.cardSuggestions')>0)
 )${position} ORDER BY updated_at DESC,key DESC LIMIT ?`};
}
export function suggestionHistoryPage(rows,query){
 const selected=rows.slice(0,query.limit),last=selected.at(-1);
 const items=selected.map(row=>{const p=JSON.parse(row.payload);return p.type==='bunker-suggestions'?{archiveKey:row.key,...p}:{archiveKey:row.key,type:'bunker-suggestions',version:1,project:p.round.project,roundId:p.round.id,archivedAt:p.archivedAt,origin:'collaboration',cardSuggestions:p.cardSuggestions};});
 return {items,nextCursor:rows.length>query.limit&&last?cursorEncode([query.project,last.updated_at,last.key]):null};
}
