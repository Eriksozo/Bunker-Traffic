// All inserts read the central row committed by D1, never unaccepted caller data.
export const archiveApprovedReportsSql=`INSERT OR IGNORE INTO bunker_reports (id,project,created_at,payload)
 SELECT json_extract(j.value,'$.id'),json_extract(j.value,'$.project'),json_extract(j.value,'$.createdAt'),json(j.value)
 FROM bunker_records c,json_each(c.payload,'$.reports') j
 WHERE c.key='central' AND json_type(j.value,'$.id')='text'
 AND json_type(j.value,'$.project')='text' AND json_type(j.value,'$.createdAt')='text'`;

export function reportCursor(row){
 const bytes=new TextEncoder().encode(JSON.stringify([row.createdAt,row.id]));
 return btoa(Array.from(bytes,b=>String.fromCharCode(b)).join('')).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
}
export function parseReportCursor(cursor){
 if(!cursor)return null;
 if(typeof cursor!=='string'||cursor.length>2000||!/^[A-Za-z0-9_-]+$/.test(cursor))throw new Error('Cursor de relatório inválido.');
 try{
  const raw=atob(cursor.replaceAll('-','+').replaceAll('_','/'));
  const value=JSON.parse(new TextDecoder().decode(Uint8Array.from(raw,c=>c.charCodeAt(0))));
  if(!Array.isArray(value)||value.length!==2||typeof value[0]!=='string'||!Number.isFinite(Date.parse(value[0]))||typeof value[1]!=='string'||!value[1]||value[1].length>2500)throw Error();
  return {createdAt:value[0],id:value[1]};
 }catch{throw new Error('Cursor de relatório inválido.');}
}
/** @param {string} project @param {number} limit @param {string|null} cursor */
export function reportsQuery(project,limit=20,cursor=null){
 if(typeof project!=='string'||!project||project.length>2500)throw new Error('Informe um projeto válido.');
 if(!Number.isInteger(limit)||limit<1||limit>50)throw new Error('Limite de relatórios inválido.');
 const after=parseReportCursor(cursor),params=[];
 const scope=project==='all'?'1=1':"project IN (?, 'all')";
 if(project!=='all')params.push(project);
 let position='';if(after){position=' AND (created_at < ? OR (created_at = ? AND id < ?))';params.push(after.createdAt,after.createdAt,after.id);}
 params.push(limit+1);
 // Legacy reports remain readable before their first archival commit. Archive wins on matching IDs.
 const sql=`WITH legacy AS (
  SELECT json_extract(j.value,'$.id') AS id,json_extract(j.value,'$.project') AS project,
  json_extract(j.value,'$.createdAt') AS created_at,json(j.value) AS payload
  FROM bunker_records c,json_each(c.payload,'$.reports') j WHERE c.key='central'
 ), combined AS (
  SELECT id,project,created_at,payload FROM bunker_reports
  UNION ALL
  SELECT l.id,l.project,l.created_at,l.payload FROM legacy l
  WHERE NOT EXISTS (SELECT 1 FROM bunker_reports a WHERE a.id=l.id)
 ) SELECT id,created_at,payload FROM combined WHERE ${scope}${position}
 ORDER BY created_at DESC,id DESC LIMIT ?`;
 return {sql,params,limit};
}
export function reportPage(rows,limit){
 const hasMore=rows.length>limit,items=rows.slice(0,limit).map(row=>JSON.parse(row.payload));
 return {items,nextCursor:hasMore&&items.length?reportCursor(items.at(-1)):null};
}
export function safeReportFilename(title){
 return (String(title||'Relatorio').replace(/[\\/:*?"<>|\u0000-\u001f]/g,' ').replace(/\s+/g,' ').trim().slice(0,140)||'Relatorio')+'.txt';
}
