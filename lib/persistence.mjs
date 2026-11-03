import {archiveApprovedReportsSql} from './report-archive.mjs';
import {compactCollaboration} from './collaboration.mjs';
import {compactOrphanSuggestions} from './suggestion-history.mjs';
import {retainKnowledgeMeasurements} from './knowledge.mjs';
import {hydrateChoiceResolutions} from './decision-resolution.mjs';
import {packSnapshotState,hydrateSnapshotState} from './snapshot-storage.mjs';
import {packCoreState,hydrateCoreState} from './core-storage.mjs';

export const centralByteLimit=1750000;
const bytes=value=>new TextEncoder().encode(value).byteLength;
function diagnostics(payload,stored,state){
 return {format:stored.coreStorage?'gzip-base64-v2':stored.snapshotStorage?'gzip-base64-v1':'legacy-json',storedBytes:bytes(payload),snapshotCount:state.snapshots?.length||0,expandedSnapshotBytes:bytes(JSON.stringify(state.snapshots||[])),limitBytes:centralByteLimit};
}
export async function readPersistedState(db,empty){
 const row=await db.prepare('SELECT payload,revision,updated_at FROM bunker_records WHERE key = ?').bind('central').first();
 if(!row)return {state:empty(),revision:0,updatedAt:null};
 const stored=JSON.parse(row.payload),{_commitToken,...encoded}=stored,state=await hydrateSnapshotState(await hydrateCoreState(encoded));
 await hydrateChoiceResolutions(db,state);
 return {state,revision:row.revision,updatedAt:row.updated_at,storage:diagnostics(row.payload,stored,state)};
}
export async function commitPersistedState(db,state,revision){
 retainKnowledgeMeasurements(state);
 const compacted=compactCollaboration(state);state=compacted.state;
 const orphaned=compactOrphanSuggestions(state);state=orphaned.state;
 // A unique, server-owned fence keeps every archive bound to this exact CAS
 // winner without repeating the potentially megabyte-sized central payload.
 const commitToken=globalThis.crypto.randomUUID(),stored={...await packCoreState(await packSnapshotState(state)),_commitToken:commitToken},payload=JSON.stringify(stored),size=bytes(payload);
 if(size>centralByteLimit){const error=new Error('Limite de armazenamento da central atingido. Nenhum dado foi descartado.');error.code='STORAGE_LIMIT';throw error;}
 const now=new Date().toISOString();
 const stmt=revision===0?db.prepare('INSERT OR IGNORE INTO bunker_records (key,payload,revision,updated_at) VALUES (?,?,?,?)').bind('central',payload,1,now):db.prepare('UPDATE bunker_records SET payload=?,revision=?,updated_at=? WHERE key=? AND revision=?').bind(payload,revision+1,now,'central',revision);
 // The compare-and-swap and all archive writes remain in the same transaction.
 const archives=[...compacted.archives,...orphaned.archives].map(a=>db.prepare(`${a.immutableNew?'INSERT':'INSERT OR IGNORE'} INTO bunker_records (key,payload,revision,updated_at) SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM bunker_records WHERE key=? AND revision=? AND json_extract(payload,'$._commitToken')=?)`).bind(a.key,JSON.stringify(a.payload),1,now,'central',revision+1,commitToken));
 const results=await db.batch([stmt,...archives,db.prepare(archiveApprovedReportsSql)]);
 if(!results[0].meta.changes)throw new Error('CONFLICT');
 return {state,revision:revision+1,updatedAt:now,storage:diagnostics(payload,stored,state)};
}
