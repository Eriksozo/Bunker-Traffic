import {safeModelUsage} from './cloud-model-diagnostics.mjs';
const textLimits=Object.freeze({stage:1600,'proposal-review':1200,dialogue:1000,'owner-question':1000});
const phaseOf=c=>c.ownerQuestion?'owner-question':c.proposal?'proposal-review':c.receivedQuestion?'dialogue':'stage';
function cap(node,path,length){
 if(!node||typeof node!=='object')return;
 if(Array.isArray(node.anyOf))for(const branch of node.anyOf)cap(branch,path,length);
 if(!path.length){if(node.type==='string')node.maxLength=Math.min(node.maxLength??Infinity,length);return;}
 cap(node[path[0]],path.slice(1),length);
}
/** Generation-only prose limits: sources, identity enums, coverage and numeric requirements stay identical. */
export function cloudOutputContract(input,context){
 const schema=structuredClone(input),phase=phaseOf(context),textMaxCharacters=textLimits[phase];
 for(const [field,n] of Object.entries({decision:160,reason:320,nextStep:220,text:textMaxCharacters}))cap(schema,['properties',field],n);
 cap(schema,['properties','campaignReadings','items','properties','reason'],180);
 for(const [field,n] of Object.entries({lesson:220,uncertainty:240,nextCheck:220}))cap(schema,['properties','reflection','properties',field],n);
 cap(schema,['properties','reflection','properties','peerChecks','items','properties','reason'],180);
 cap(schema,['properties','memoryReview','properties','reason'],240);
 cap(schema,['properties','learningReview','properties','reason'],360);
 cap(schema,['properties','suggestions','items','properties','reason'],360);
 cap(schema,['properties','suggestions','items','properties','learning','properties','reason'],240);
 cap(schema,['properties','question','properties','text'],360);
 return {schema,requirements:{version:1,phase,textMaxCharacters,rule:'Texto curto e próprio: conclusão, contraponto principal e condição de revisão. Não repetir toda a tabela ou os pareceres anteriores. Preservar TODOS os alvos, números exigidos, citações, dúvidas materiais e limitações. Encurtar a prosa, nunca a evidência. Não adivinhar, cortar ou completar uma resposta parcial.'}};
}
/** Count final output and provider-reported usage without retaining content or reasoning. */
export function cloudGenerationProfile(response,raw,requirements,maxTokens,sampling={}){
 const encoded=JSON.stringify(raw),fields=new Set(['decision','reason','nextStep','text','lesson','uncertainty','nextCheck']);let proseCharacters=0;
 const visit=value=>{if(!value||typeof value!=='object')return;for(const [key,v] of Object.entries(value)){if(typeof v==='string'&&fields.has(key))proseCharacters+=v.length;else if(v&&typeof v==='object')visit(v);}};visit(raw);
 return {version:1,contractVersion:requirements.version,phase:requirements.phase,textMaxCharacters:requirements.textMaxCharacters,textCharacters:raw.text.length,textWithinRequestedCap:raw.text.length<=requirements.textMaxCharacters,maxTokens,...(typeof sampling.temperature==='number'?{temperature:sampling.temperature}:{}),...(sampling.adjustment==='after_output_truncated'?{adjustment:sampling.adjustment}:{}),...(sampling.recovered==='trailing_whitespace'?{recovered:sampling.recovered}:{}),finalOutputBytes:new TextEncoder().encode(encoded).length,proseCharacters,usage:safeModelUsage(response?.usage),interpretation:'Tamanho da saída final e uso informado pelo provedor; não mede qualidade, latência futura nem eficácia financeira.'};
}
