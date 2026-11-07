/** Owner-facing summary of a sanitized storage diagnostic. Only fixed vocabulary is rendered; unknown values are omitted. */
const operations={get:'leitura',cas:'gravação',commit:'gravação da central',daily:'diário de campanhas',suggestions:'histórico de sugestões',collaborations:'histórico de colaborações',reports:'relatórios',resolutions:'recibos de decisão',cloudExecutor:'controle do executor',malvaRead:'ponte Malva',malvaMcp:'ponte Malva',orbitaMcp:'ponte Órbita'};
const keyClasses={central:'central',snapshots:'fontes',live:'dados atuais',creative:'criativos',daily:'diário',collaboration:'colaborações',suggestions:'sugestões',other:'outros registros'};
const transports={timeout:'tempo esgotado na conexão',network:'falha de rede',decode:'resposta inválida'};
const sqlStates={'57014':'tempo-limite do banco','55P03':'espera de bloqueio no banco','40001':'conflito de transação','53300':'conexões esgotadas no banco'};
const seconds=ms=>(ms/1000).toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1})+' s';
export function storageDiagnosticLabel(storage){
 if(!storage||typeof storage!=='object'||!Object.hasOwn(operations,storage.op))return '';
 const classes=storage.op!=='commit'&&Array.isArray(storage.keyClasses)?storage.keyClasses.filter(k=>Object.hasOwn(keyClasses,k)).map(k=>keyClasses[k]):[];
 const parts=[operations[storage.op]+(classes.length?' ('+classes.join(', ')+')':'')];
 if(Number.isFinite(storage.ms)&&storage.ms>=0)parts.push(seconds(storage.ms));
 if(Object.hasOwn(transports,storage.transport))parts.push(transports[storage.transport]);
 if(typeof storage.pgCode==='string')parts.push(sqlStates[storage.pgCode]||'código do banco '+(/^[0-9A-Z]{5}$/.test(storage.pgCode)?storage.pgCode:'desconhecido'));
 else if(Number.isSafeInteger(storage.status)&&storage.status>=400&&!storage.transport)parts.push('HTTP '+storage.status);
 return 'armazenamento: '+parts.join(' · ');
}
