import {buildDecisionCards} from './decision-cards.mjs';
import {campaignLiveDrift} from './campaign-live-context.mjs';
import {storage} from './storage';
import {readState} from './state';
import {liveDataAction,readLiveData} from './live-data.mjs';
import hosting from '../.openai/hosting.json';

export async function readLiveState(){
 const {state}=await readState();return {...await readLiveData(storage(),state),siteProjectId:hosting.project_id};
}
export async function updateLiveState(input:Record<string,unknown>,state?:unknown){
 const configuredState=state??(await readState()).state;
 return {...await liveDataAction(storage(),configuredState,input),siteProjectId:hosting.project_id};
}

/** Cache is not evidence for analysis or approval. A newer divergent native
 * state can only veto a stale choice until a full reread has been completed. */
export async function assertCurrentDecisionContext(state:any,input:any){
 if(input.op!=='cardDecision'&&!(input.op==='proposalReview'&&input.decision==='approve'))return;
 const proposal=input.op==='proposalReview'?(state.proposals||[]).find((p:any)=>p.id===input.id):null;
 const project=input.project||proposal?.project;if(!project)return;
 const cards=buildDecisionCards(state,project),card=cards.find((c:any)=>input.op==='cardDecision'?c.id===input.cardId:c.row.externalId===proposal?.payload.objectId&&c.row.adAccountId===proposal?.payload.adAccountId);
 if(!card)return;
 const latest=await readLiveData(storage(),state,project);
 const drift=campaignLiveDrift(card,latest.items);
 if(drift)throw Error(drift.kind==='native'?'O status ou orçamento mudou na plataforma. Aguarde uma nova análise antes de registrar outra decisão.':'O cenário de desempenho mudou ou a análise venceu. Aguarde a releitura e os novos pareceres antes de decidir.');
}
