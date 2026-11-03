/** Lossless storage for growing journals. Reports remain directly readable by
 * the transactional SQL archive; snapshots retain their separate bounded codec. */
export const coreStorageLimits=Object.freeze({thresholdBytes:250000,maxRawBytes:16000000,maxEncodedChars:1750000});
const encoder=new TextEncoder(),own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const object=o=>!!o&&typeof o==='object'&&!Array.isArray(o);
const passthrough=new Set(['snapshots','snapshotStorage','reports']);
function invalid(reason){const e=new Error('Histórico armazenado inválido: '+reason+'.');e.code='STORAGE_LIMIT';throw e;}
function base64(bytes){let s='';for(let i=0;i<bytes.length;i+=32768)s+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(s);}
async function digest(raw){const h=new Uint8Array(await crypto.subtle.digest('SHA-256',raw));return 'sha256:'+Array.from(h,b=>b.toString(16).padStart(2,'0')).join('');}
async function bounded(stream,limit){
 const reader=stream.getReader(),chunks=[];let size=0;
 try{while(true){const x=await reader.read();if(x.done)break;size+=x.value.byteLength;if(size>limit)invalid('expansão acima do limite');chunks.push(x.value);}}
 catch(e){try{await reader.cancel();}catch{}throw e;}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.byteLength;}return bytes;
}
export async function packCoreState(state){
 if(!object(state)||own(state,'coreStorage'))invalid('estado lógico esperado');
 const core={},outer={};for(const [key,value] of Object.entries(state))(passthrough.has(key)?outer:core)[key]=value;
 const raw=encoder.encode(JSON.stringify(core));if(raw.byteLength<=coreStorageLimits.thresholdBytes)return state;
 if(raw.byteLength>coreStorageLimits.maxRawBytes)invalid('histórico acima do limite');
 const compressed=await bounded(new Blob([raw]).stream().pipeThrough(new CompressionStream('gzip')),Math.floor(coreStorageLimits.maxEncodedChars/4)*3);
 return {...outer,coreStorage:{kind:'bunker-core',version:1,encoding:'gzip-base64',rawBytes:raw.byteLength,digest:await digest(raw),data:base64(compressed)}};
}
export async function hydrateCoreState(stored){
 if(!object(stored))invalid('estado ausente');if(!own(stored,'coreStorage'))return stored;
 const e=stored.coreStorage;
 if(Object.keys(stored).some(k=>k!=='coreStorage'&&!passthrough.has(k)))invalid('histórico aberto e compactado misturados');
 if(!object(e)||e.kind!=='bunker-core'||e.version!==1||e.encoding!=='gzip-base64'||!Number.isSafeInteger(e.rawBytes)||e.rawBytes<2||e.rawBytes>coreStorageLimits.maxRawBytes||typeof e.digest!=='string'||!/^sha256:[0-9a-f]{64}$/.test(e.digest))invalid('metadados de integridade');
 if(typeof e.data!=='string'||!e.data.length||e.data.length>coreStorageLimits.maxEncodedChars||e.data.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(e.data))invalid('base64');
 let compressed;try{compressed=Uint8Array.from(atob(e.data),c=>c.charCodeAt(0));}catch{invalid('base64');}if(base64(compressed)!==e.data)invalid('base64 não canônico');
 let raw;try{raw=await bounded(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip')),e.rawBytes);}catch{invalid('conteúdo compactado ou tamanho inconsistente');}
 if(raw.byteLength!==e.rawBytes||await digest(raw)!==e.digest)invalid('integridade do conteúdo');
 let core;try{core=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch{invalid('JSON ou UTF-8');}
 if(!object(core)||Object.keys(core).some(k=>k==='coreStorage'||passthrough.has(k)||['__proto__','constructor','prototype'].includes(k)))invalid('campos misturados');
 const outer={...stored};delete outer.coreStorage;return {...core,...outer};
}
