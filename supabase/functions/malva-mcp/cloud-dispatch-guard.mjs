import {CloudError} from './cloud-malva.mjs';
const canonical=v=>JSON.stringify(v,(_k,o)=>o&&typeof o==='object'&&!Array.isArray(o)?Object.fromEntries(Object.keys(o).sort().map(k=>[k,o[k]])):o);
/** Additional server fence; never replaces claim/prepare/submit in the Bunker journal. A Bunk autonomy order also
 * needs the owner's general switch still on at dispatch (docs/autonomy-policy.md). */
export function authorizeCloudDispatch(state,input,now=Date.now()){
 const proof=input.execution;if(!proof?.id||!proof?.submitClientId)throw new CloudError('MCP_APPROVAL_REQUIRED');
 const e=state.executions?.find(e=>e.id===proof.id),p=state.proposals?.find(p=>p.id===e?.proposalId),pf=e?.preflight?.row;
 if(state.paused||!e||!p||p.autonomyOrder===true&&state.autonomy?.enabled!==true||e.status!=='Enviada'||!e.submittedAt||e.submitClientId!==proof.submitClientId||p.status!=='Aprovada'||p.approvedVersion!==p.version||p.approvedSignature!==p.signature||e.proposalVersion!==p.version||e.proposalSignature!==p.signature||Date.parse(p.expiresAt)<=now||!Number.isFinite(Date.parse(p.expiresAt))||!Number.isFinite(Date.parse(e.preflight?.fetchedAt))||Date.parse(e.preflight.fetchedAt)>now||now-Date.parse(e.preflight.fetchedAt)>120000||Date.parse(e.submittedAt)>now||!pf||pf.adAccountId!==p.payload.adAccountId||pf.externalId!==p.payload.objectId||pf.provider!=='meta'||pf.budgetCurrency!==p.payload.currency||e.currency!==p.payload.currency)throw new CloudError('MCP_APPROVAL_REQUIRED');
 const args={objectId:pf.id,projectId:p.project},expected=p.payload.action==='budget'?{tool:'tracking_set_ad_budget',arguments:{...args,dailyBudget:p.payload.after.dailyBudget}}:p.payload.action==='status'?{tool:'tracking_set_ad_status',arguments:{...args,status:p.payload.after.status}}:null;
 if(!expected||canonical(e.command)!==canonical(expected)||canonical(expected)!==canonical({tool:input.tool,arguments:input.args}))throw new CloudError('MCP_COMMAND_MISMATCH');
 return {executionId:e.id,proposalId:p.id,command:expected};
}
