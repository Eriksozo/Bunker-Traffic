/** A successful HTTP response is not a receipt for an owner's decision.
 * These helpers inspect the returned persisted state without changing it.
 */
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const text=value=>typeof value==='string'&&value.trim().length>0;
const actions=new Set(['increase','reduce','pause','keep']);

export function isValidCentralResponse(data){
 const state=data?.state;
 if(!object(data)||!Number.isSafeInteger(data.revision)||data.revision<0||!object(state)||!object(state.config)||typeof state.paused!=='boolean')return false;
 const required=['snapshots','tasks','decisions','jobs','messages','reports','events'];
 const journals=['ownerChoices','executions','proposals','collaborationRounds','collaborationMessages','campaignObservations'];
 return required.every(key=>Array.isArray(state[key]))&&journals.every(key=>state[key]===undefined||Array.isArray(state[key]));
}

function requestPercent(input){
 if(input.choice==='keep'||input.choice==='pause')return input.percent===undefined||input.percent===null?{valid:true,value:null}:{valid:false};
 const value=input.percent;
 return typeof value==='number'&&Number.isFinite(value)&&value>0&&value<=(input.choice==='increase'?1000:100)&&!(input.choice==='reduce'&&value>=100)?{valid:true,value}:{valid:false};
}
function requestReason(input){
 if(input.reason===undefined)return {valid:true,value:''};
 if(typeof input.reason!=='string'||input.reason.length>2500)return {valid:false};
 // recordOwnerChoice supplies the default before trimming. Whitespace alone
 // is invalid there; the UI normally sends an already-trimmed string.
 const value=(input.reason||'Sem motivo adicional.').trim();
 return value?{valid:true,value}:{valid:false};
}
function sameIdentity(choice,input){
 if(!text(choice.project)||!text(choice.adAccountId)||!text(choice.objectId))return false;
 const identity='campaign:'+encodeURIComponent(choice.project)+':'+encodeURIComponent(choice.adAccountId)+':'+encodeURIComponent(choice.objectId);
 return choice.project===input.project&&choice.cardId===input.cardId&&identity===input.cardId;
}

/** Return only the exact saved choice, including an idempotent replay receipt.
 * A different clientId can legitimately resolve to the original immutable
 * record; matching only a clientId, campaign name or HTTP status is insufficient.
 * This confirms a saved choice, never provider execution or financial success.
 */
export function confirmedOwnerChoice(data,input){
 if(!isValidCentralResponse(data)||!Array.isArray(data.state.ownerChoices)||!object(input)||input.op!=='cardDecision'||!text(input.project)||!text(input.cardId)||!text(input.signature)||!text(input.clientId)||input.clientId.length>150||!actions.has(input.choice))return null;
 const percent=requestPercent(input),reason=requestReason(input);
 if(!percent.valid||!reason.valid)return null;
 const approved=input.approveExact===true;
 if(approved&&(input.choice==='keep'||!text(input.proposalId)||!text(input.proposalSignature)||!Number.isSafeInteger(input.proposalVersion)||input.proposalVersion<1))return null;
 if(!approved&&[input.proposalId,input.proposalVersion,input.proposalSignature].some(value=>value!==undefined&&value!==null))return null;
 const matches=data.state.ownerChoices.filter(choice=>{
  if(!object(choice)||!text(choice.id)||!text(choice.clientId)||!text(choice.ownerId)||!sameIdentity(choice,input)||choice.cardSignature!==input.signature||choice.action!==input.choice||choice.choice!==input.choice||choice.percent!==percent.value||choice.reason!==reason.value)return false;
  if(approved)return choice.status==='Autorizado'&&choice.proposalId===input.proposalId&&choice.proposalVersion===input.proposalVersion&&choice.proposalSignature===input.proposalSignature;
  return choice.status===(input.choice==='keep'?'Mantido':'Pendente de revisão')&&choice.proposalId===null&&choice.proposalVersion===undefined&&choice.proposalSignature===undefined;
 });
 return matches.length===1?matches[0]:null;
}
