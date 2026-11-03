/** Lossless snapshot storage. Only the persisted copy is compressed; callers
 * always work with the original logical snapshots and their existing seals. */
export const snapshotStorageLimits=Object.freeze({maxRawBytes:16000000,maxSnapshots:512,maxRows:100000,maxRowsPerSnapshot:3000,maxEncodedChars:1750000});
const encoder=new TextEncoder();
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
function invalid(reason){throw new Error('Leituras armazenadas inválidas: '+reason+'.');}
function counts(snapshots){
 if(!Array.isArray(snapshots)||snapshots.length>snapshotStorageLimits.maxSnapshots)invalid('quantidade de leituras');
 let rowCount=0;
 for(const snapshot of snapshots){
  if(!object(snapshot)||!Array.isArray(snapshot.rows)||snapshot.rows.length>snapshotStorageLimits.maxRowsPerSnapshot)invalid('linhas ausentes ou acima do limite');
  rowCount+=snapshot.rows.length;if(rowCount>snapshotStorageLimits.maxRows)invalid('quantidade de linhas');
 }
 return {snapshotCount:snapshots.length,rowCount};
}
async function digest(bytes){
 const value=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
 return 'sha256:'+Array.from(value,b=>b.toString(16).padStart(2,'0')).join('');
}
function base64(bytes){
 let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
 return btoa(binary);
}
function unbase64(value){
 if(typeof value!=='string'||!value.length||value.length>snapshotStorageLimits.maxEncodedChars||value.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(value))invalid('base64');
 let bytes;try{bytes=Uint8Array.from(atob(value),c=>c.charCodeAt(0));}catch{invalid('base64');}
 if(base64(bytes)!==value)invalid('base64 não canônico');
 return bytes;
}
/** Reads incrementally so neither a false size header nor a zip bomb can
 * allocate an unbounded decompressed buffer before validation. */
async function boundedBytes(stream,limit){
 const reader=stream.getReader(),chunks=[];let length=0;
 try{
  while(true){const item=await reader.read();if(item.done)break;length+=item.value.byteLength;if(length>limit)invalid('expansão acima do limite');chunks.push(item.value);}
 }catch(error){try{await reader.cancel();}catch{/* Preserve the original failure. */}throw error;}
 finally{reader.releaseLock();}
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 return bytes;
}
export async function packSnapshotState(state){
 if(!object(state)||own(state,'snapshotStorage'))invalid('estado lógico esperado');
 const measured=counts(state.snapshots),raw=encoder.encode(JSON.stringify(state.snapshots));
 if(raw.byteLength>snapshotStorageLimits.maxRawBytes)invalid('tamanho das leituras acima do limite');
 const compressed=await boundedBytes(new Blob([raw]).stream().pipeThrough(new CompressionStream('gzip')),Math.floor(snapshotStorageLimits.maxEncodedChars/4)*3);
 const data=base64(compressed);if(data.length>snapshotStorageLimits.maxEncodedChars)invalid('tamanho compactado acima do limite');
 return {...state,snapshots:[],snapshotStorage:{kind:'bunker-snapshots',version:1,encoding:'gzip-base64',digest:await digest(raw),rawBytes:raw.byteLength,...measured,data}};
}
export async function hydrateSnapshotState(stored){
 if(!object(stored))invalid('estado ausente');
 if(!own(stored,'snapshotStorage')){counts(stored.snapshots);return {...stored};}
 const envelope=stored.snapshotStorage;
 if(!object(envelope)||envelope.kind!=='bunker-snapshots'||envelope.version!==1||envelope.encoding!=='gzip-base64')invalid('formato desconhecido');
 if(!Array.isArray(stored.snapshots)||stored.snapshots.length!==0)invalid('fontes compactadas e abertas misturadas');
 if(!Number.isSafeInteger(envelope.rawBytes)||envelope.rawBytes<2||envelope.rawBytes>snapshotStorageLimits.maxRawBytes||!Number.isSafeInteger(envelope.snapshotCount)||envelope.snapshotCount<0||envelope.snapshotCount>snapshotStorageLimits.maxSnapshots||!Number.isSafeInteger(envelope.rowCount)||envelope.rowCount<0||envelope.rowCount>snapshotStorageLimits.maxRows||typeof envelope.digest!=='string'||!/^sha256:[0-9a-f]{64}$/.test(envelope.digest))invalid('metadados de integridade');
 const compressed=unbase64(envelope.data);let raw;
 try{raw=await boundedBytes(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip')),envelope.rawBytes);}catch{invalid('conteúdo compactado ou tamanho inconsistente');}
 if(raw.byteLength!==envelope.rawBytes||await digest(raw)!==envelope.digest)invalid('integridade do conteúdo');
 let snapshots;try{snapshots=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch{invalid('conteúdo JSON ou UTF-8');}
 const measured=counts(snapshots);
 if(measured.snapshotCount!==envelope.snapshotCount||measured.rowCount!==envelope.rowCount)invalid('contagem divergente');
 const logical={...stored};delete logical.snapshotStorage;
 return {...logical,snapshots};
}
