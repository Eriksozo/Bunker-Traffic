/** A short authored explanation. It never creates a proposal or authorization. */
export function normalizeAgentSummary(value){
 if(value===undefined)return null;
 const limits={decision:240,reason:480,nextStep:240};
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw Error('Resumo do agente inválido.');
 const keys=Reflect.ownKeys(value);
 if(keys.length!==3||keys.some(key=>typeof key!=='string'||!Object.prototype.hasOwnProperty.call(limits,key)))throw Error('Resumo exige somente decision, reason e nextStep.');
 for(const [key,max] of Object.entries(limits)){
  const text=value[key];
  if(typeof text!=='string'||!text.trim()||text.length>max)throw Error(`Resumo: ${key} deve ter de 1 a ${max} caracteres.`);
 }
 return {decision:value.decision.trim(),reason:value.reason.trim(),nextStep:value.nextStep.trim()};
}
