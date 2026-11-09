/** Account warm-up is operational cost, not a sales optimization candidate. */
export function isWarmupCampaign(name){
 const normalized=typeof name==='string'?name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,' '):'';
 return /\b(?:ENGAJ(?:AMENTO)?S?|ENGAGE(?:MENT)?S?|AQUEC(?:IMENTO|ER|IDA|IDO|ENDO)?S?|WARM ?UPS?)\d*\b/.test(normalized);
}

function currentRow(state,project,level,account,externalId){
 if(!account||!externalId)return null;
 const sources=(state.snapshots||[]).filter(s=>s.projectId===project&&s.level===level&&Array.isArray(s.rows)).slice().sort((a,b)=>(b.period==='today')-(a.period==='today')||(Date.parse(b.fetchedAt)||0)-(Date.parse(a.fetchedAt)||0));
 for(const source of sources){const row=source.rows.find(r=>r.adAccountId===account&&r.externalId===externalId);if(row)return row;}
 return null;
}

/** Resolve parents with account/project scope; a fresh supplied row takes priority. */
export function isWarmupTarget(state,project,level,row){
 if(!row)return false;
 const target={...currentRow(state,project,level,row.adAccountId,row.externalId),...row};
 if(level==='campaign')return isWarmupCampaign(target.name);
 if(isWarmupCampaign(target.campaignName))return true;
 const parent=level==='ad'&&target.adsetExternalId?currentRow(state,project,'adset',target.adAccountId,target.adsetExternalId):null;
 const campaignId=target.campaignExternalId||parent?.campaignExternalId;
 return isWarmupCampaign(currentRow(state,project,'campaign',target.adAccountId,campaignId)?.name);
}
