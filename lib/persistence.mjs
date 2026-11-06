import {archiveApprovedReportsSql} from './report-archive.mjs';
import {compactCollaboration} from './collaboration.mjs';
import {compactOrphanSuggestions} from './suggestion-history.mjs';
import {retainKnowledgeMeasurements} from './knowledge.mjs';
import {hydrateChoiceResolutions} from './decision-resolution.mjs';
import {packSnapshotState,hydrateSnapshotState} from './snapshot-storage.mjs';
import {packCoreState,hydrateCoreState} from './core-storage.mjs';

export const centralByteLimit=1750000;
// Keep headroom for new journals. Each immutable source blob has the same
// bounded codec/row ceiling; repeated journal writes reuse its content address.
export const centralInlineTarget=1300000;
const bytes=value=>new TextEncoder().encode(value).byteLength;
function diagnostics(payload,stored,state){
 return {format:stored.snapshotStorage?.kind==='bunker-snapshot-reference'?'gzip-base64-v3':stored.coreStorage?'gzip-base64-v2':stored.snapshotStorage?'gzip-base64-v1':'legacy-json',storedBytes:bytes(payload),snapshotCount:state.snapshots?.length||0,expandedSnapshotBytes:bytes(JSON.stringify(state.snapshots||[])),limitBytes:centralByteLimit};
}
function sourceFailure(){const error=new Error('Leituras armazenadas ausentes ou inconsistentes. Nenhum dado foi substituído por zero.');error.code='STORAGE_INTEGRITY';return error;}
async function resolveSnapshotReference(db,stored){
 const ref=stored.snapshotStorage;
 if(ref?.kind!=='bunker-snapshot-reference')return stored;
 if(ref.version!==1||typeof ref.digest!=='string'||!/^sha256:[0-9a-f]{64}$/.test(ref.digest)||ref.key!=='snapshots:'+ref.digest.slice(7)||Object.keys(ref).some(k=>!['kind','version','digest','key'].includes(k)))throw sourceFailure();
 const row=await db.prepare('SELECT payload,revision,updated_at FROM bunker_records WHERE key = ?').bind(ref.key).first();
 if(!row||typeof row.payload!=='string'||bytes(row.payload)>centralByteLimit)throw sourceFailure();
 let blob;try{blob=JSON.parse(row.payload);}catch{throw sourceFailure();}
 if(blob.kind!=='bunker-snapshot-blob'||blob.version!==1||blob.snapshotStorage?.digest!==ref.digest||Object.keys(blob).some(k=>!['kind','version','snapshotStorage'].includes(k)))throw sourceFailure();
 return {...stored,snapshotStorage:blob.snapshotStorage};
}
export async function readPersistedState(db,empty){
 const row=await db.prepare('SELECT payload,revision,updated_at FROM bunker_records WHERE key = ?').bind('central').first();
 if(!row)return {state:empty(),revision:0,updatedAt:null};
 const stored=JSON.parse(row.payload),{_commitToken,...encoded}=stored,state=await hydrateSnapshotState(await resolveSnapshotReference(db,await hydrateCoreState(encoded)));
 await hydrateChoiceResolutions(db,state);
 return {state,revision:row.revision,updatedAt:row.updated_at,storage:diagnostics(row.payload,stored,state)};
}
export async function commitPersistedState(db,state,revision){
 retainKnowledgeMeasurements(state);
 const compacted=compactCollaboration(state);state=compacted.state;
 const orphaned=compactOrphanSuggestions(state);state=orphaned.state;
 // A unique, server-owned fence keeps every archive bound to this exact CAS
 // winner without repeating the potentially megabyte-sized central payload.
 const commitToken=globalThis.crypto.randomUUID();let stored={...await packCoreState(await packSnapshotState(state)),_commitToken:commitToken};
 const sourceArchives=[];
 if(bytes(JSON.stringify(stored))>centralInlineTarget){
  const envelope=stored.snapshotStorage,key='snapshots:'+envelope.digest.slice(7),blob={kind:'bunker-snapshot-blob',version:1,snapshotStorage:envelope};
  if(bytes(JSON.stringify(blob))>centralByteLimit){const error=new Error('Leituras acima do limite por registro. Nenhum dado foi descartado.');error.code='STORAGE_LIMIT';throw error;}
  sourceArchives.push({key,payload:blob});
  stored={...stored,snapshotStorage:{kind:'bunker-snapshot-reference',version:1,key,digest:envelope.digest}};
 }
 const payload=JSON.stringify(stored),size=bytes(payload);
 if(size>centralByteLimit){const error=new Error('Limite de armazenamento da central atingido. Nenhum dado foi descartado.');error.code='STORAGE_LIMIT';throw error;}
 const now=new Date().toISOString();
 const stmt=revision===0?db.prepare('INSERT OR IGNORE INTO bunker_records (key,payload,revision,updated_at) VALUES (?,?,?,?)').bind('central',payload,1,now):db.prepare('UPDATE bunker_records SET payload=?,revision=?,updated_at=? WHERE key=? AND revision=?').bind(payload,revision+1,now,'central',revision);
 // The compare-and-swap and all archive writes remain in the same transaction.
 const archives=[...sourceArchives,...compacted.archives,...orphaned.archives].map(a=>db.prepare(`${a.immutableNew?'INSERT':'INSERT OR IGNORE'} INTO bunker_records (key,payload,revision,updated_at) SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM bunker_records WHERE key=? AND revision=? AND json_extract(payload,'$._commitToken')=?)`).bind(a.key,JSON.stringify(a.payload),1,now,'central',revision+1,commitToken));
 const results=await db.batch([stmt,...archives,db.prepare(archiveApprovedReportsSql)]);
 if(!results[0].meta.changes)throw new Error('CONFLICT');
 return {state,revision:revision+1,updatedAt:now,storage:diagnostics(payload,stored,state)};
}
