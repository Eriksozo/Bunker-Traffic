import test from 'node:test';
import assert from 'node:assert/strict';
import {campaignObservationLimits,reconcileCampaignObservations,latestCampaignChange,campaignIncident,campaignReviewMarker,campaignNativeDrift} from '../lib/campaign-observation.mjs';

const now=Date.parse('2026-11-03T18:00:00Z');
const row=(patch={})=>({id:'internal',externalId:'c',adAccountId:'account',name:'Teste',accountName:'Conta',level:'campaign',provider:'meta',status:'PAUSED',effectiveStatus:'PAUSED',dailyBudget:100,lifetimeBudget:0,budgetCurrency:'BRL',...patch});
const read=(patch={})=>({projectId:'john',projectName:'John',source:'Malva MCP',period:'today',level:'campaign',complete:true,timezone:'America/Boa_Vista',from:'2026-11-03T04:00:00Z',to:'2026-11-04T04:00:00Z',fetchedAt:'2026-11-03T17:00:00Z',rows:[row()],...patch});
const next=(rows=[row({status:'ACTIVE',effectiveStatus:'ACTIVE'})],patch={})=>read({fetchedAt:'2026-11-03T17:30:00Z',rows,...patch});
const state=()=>({snapshots:[read()],ownerChoices:[{id:'choice'}],proposals:[{id:'proposal'}],executions:[{id:'execution',status:'Enviada'}]});

test('native changes record observed time and provenance without crediting the Bunker or an actor',()=>{
 const s=state(),untouched=structuredClone(s);const result=reconcileCampaignObservations(s,[next()],now);
 assert.equal(result.inserted,1);const change=s.campaignChanges[0];
 assert.deepEqual(change.changes,[{field:'status',before:'PAUSED',after:'ACTIVE'},{field:'effectiveStatus',before:'PAUSED',after:'ACTIVE'}]);
 assert.equal(change.observedAt,'2026-11-03T17:30:00.000Z');assert.equal(change.previousObservedAt,'2026-11-03T17:00:00.000Z');
 assert.equal(change.actor,null);assert.equal(change.occurredAt,null);assert.equal(change.executionByBunker,false);assert.equal(change.origin,'observed');assert.equal(change.source,'Malva MCP');
 for(const field of ['snapshots','ownerChoices','proposals','executions'])assert.deepEqual(s[field],untouched[field]);
});
test('repeat and out-of-order imports are ignored and never create duplicate changes',()=>{
 const s=state(),n=next();reconcileCampaignObservations(s,[n,n],now);assert.equal(s.campaignChanges.length,1);
 assert.equal(reconcileCampaignObservations(s,[n],now).inserted,0);
 assert.equal(reconcileCampaignObservations(s,[next([row({status:'ACTIVE'})],{fetchedAt:'2026-11-03T17:20:00Z'})],now).inserted,0);
 assert.equal(reconcileCampaignObservations(s,[read({fetchedAt:'2026-11-03T16:00:00Z'})],now).inserted,0);
 const clone=state();reconcileCampaignObservations(clone,[n],now);assert.equal(clone.campaignChanges[0].id,s.campaignChanges[0].id);
});
test('complete today baseline can cross midnight; historical performance windows never supply native state',()=>{
 const old=read({from:'2026-11-02T04:00:00Z',to:'2026-11-03T04:00:00Z',fetchedAt:'2026-11-03T03:50:00Z'}),s={snapshots:[old]};
 assert.equal(reconcileCampaignObservations(s,[next()],now).inserted,1);
 for(const period of ['7d','3d','yesterday']){const other={snapshots:[read({period})]};assert.equal(reconcileCampaignObservations(other,[next()],now).inserted,0);}
});
test('partial, invalid, future, non-current and non-Malva snapshots cannot create observations',()=>{
 for(const patch of [{complete:false},{source:'Manual'},{period:'yesterday'},{level:'adset'},{fetchedAt:'invalid'},{fetchedAt:'2026-11-03T18:01:00Z'},{timezone:'bad/zone'},{from:'2026-11-02T04:00:00Z',to:'2026-11-03T04:00:00Z',fetchedAt:'2026-11-02T17:00:00Z'}]){
  const s=state();assert.equal(reconcileCampaignObservations(s,[next(undefined,patch)],now).inserted,0);assert.equal(s.campaignChanges,undefined);
 }
 const s={snapshots:[read({complete:false})]};assert.equal(reconcileCampaignObservations(s,[next()],now).inserted,0);
});
test('unknown attributes never become zero or a status change; known currency and zero budgets are tracked',()=>{
 const s={snapshots:[read({rows:[row({status:undefined,effectiveStatus:null,dailyBudget:null,lifetimeBudget:undefined,budgetCurrency:undefined})]})]};
 assert.equal(reconcileCampaignObservations(s,[next([row({status:'ACTIVE',effectiveStatus:'ACTIVE',dailyBudget:200,lifetimeBudget:0,budgetCurrency:'USD'})])],now).inserted,0);
 const currency=state();reconcileCampaignObservations(currency,[next([row({budgetCurrency:'USD',dailyBudget:0,lifetimeBudget:250})])],now);
 assert.deepEqual(currency.campaignChanges[0].changes,[{field:'dailyBudget',before:100,after:0},{field:'lifetimeBudget',before:0,after:250},{field:'budgetCurrency',before:'BRL',after:'USD'}]);
 const missing=state();assert.equal(reconcileCampaignObservations(missing,[next([row({status:undefined,effectiveStatus:undefined,dailyBudget:null,lifetimeBudget:null,budgetCurrency:undefined})])],now).inserted,0);
});
test('identity includes project, account and Meta provider; names and internal IDs cannot merge campaigns',()=>{
 const s={snapshots:[read({rows:[row(),row({adAccountId:'other',status:'ACTIVE'})]}),read({projectId:'gabe',rows:[row({status:'ACTIVE'})]})]};
 const result=reconcileCampaignObservations(s,[next([row({id:'new-internal',name:'Renomeada',status:'ACTIVE'}),row({adAccountId:'other',status:'ACTIVE'})]),next([row({status:'ACTIVE'})],{projectId:'gabe'})],now);
 assert.equal(result.inserted,1);assert.equal(s.campaignChanges[0].project,'john');assert.equal(s.campaignChanges[0].name,'Renomeada');
 assert.equal(latestCampaignChange(s,'gabe',row()),null);assert.equal(latestCampaignChange(s,'john',row({adAccountId:'other'})),null);assert.equal(latestCampaignChange(s,'john',row({provider:'google'})),null);
 assert.equal(reconcileCampaignObservations({snapshots:[read()]},[next([row({provider:'google',status:'ACTIVE'})])],now).inserted,0);
});
test('missing rows are never inferred as paused or deleted; first observations and duplicate identities supply no transition',()=>{
 assert.equal(reconcileCampaignObservations(state(),[next([])],now).inserted,0);
 assert.equal(reconcileCampaignObservations({snapshots:[]},[next()],now).inserted,0);
 assert.equal(reconcileCampaignObservations(state(),[next([row({status:'ACTIVE'}),row({status:'ACTIVE'})])],now).inserted,0);
 assert.equal(reconcileCampaignObservations({snapshots:[read({rows:[row(),row()]})]},[next()],now).inserted,0);
});
test('capacity fails atomically without deleting prior history or changing unrelated state',()=>{
 const s=state();s.campaignChanges=Array.from({length:campaignObservationLimits.changes},(_,i)=>({id:String(i)}));const before=structuredClone(s);
 assert.throws(()=>reconcileCampaignObservations(s,[next()],now),/Limite de mudanças/);assert.deepEqual(s,before);
});
test('incident scope matches exact accounts and campaign pairs and does not claim individual pauses',()=>{
 const broad={id:'broad',project:'john',status:'Interrompido',reportedAt:'2026-11-03T16:00:00Z',scope:{}},scoped={id:'specific',project:'john',status:'Em retomada',reportedAt:'2026-11-03T17:00:00Z',scope:{accountIds:['account'],objectIds:[{adAccountId:'account',objectId:'c'}]}},s={incidents:[scoped,broad]};
 assert.equal(campaignIncident(s,'john',row()),scoped);assert.equal(campaignIncident(s,'john',row({externalId:'other'})),broad);assert.equal(campaignIncident(s,'john',row({adAccountId:'other'})),broad);assert.equal(campaignIncident(s,'gabe',row()),null);
 assert.equal(campaignIncident({incidents:[{...broad,scope:{objectIds:['c']}}]},'john',row()),null);
 assert.equal(campaignIncident({incidents:[broad,{...scoped,status:'Encerrado'}]},'john',row()),null);
 assert.equal(broad.scope.paused,undefined);
});
test('review marker returns the newest applicable change or declared incident with a stable identity',()=>{
 const s=state();reconcileCampaignObservations(s,[next()],now);let marker=campaignReviewMarker(s,'john',row());
 assert.equal(marker.kind,'change');assert.equal(marker.id,s.campaignChanges[0].id);assert.equal(marker.at,'2026-11-03T17:30:00.000Z');
 s.incidents=[{id:'incident',project:'john',status:'Em retomada',reportedAt:'2026-11-03T17:40:00Z'}];marker=campaignReviewMarker(s,'john',row());assert.equal(marker.kind,'incident');assert.equal(marker.incident,s.incidents[0]);
 assert.equal(campaignReviewMarker(s,'gabe',row()),null);
});
test('empty incident scope lists mean the project while non-empty account and campaign scopes still constrain it',()=>{
 const incident={id:'incident',project:'john',status:'Interrompido',reportedAt:'2026-11-03T17:00:00Z'};
 for(const scope of [{accountIds:[]},{objectIds:[]},{accountIds:[],objectIds:[]}]){
  const s={incidents:[{...incident,scope}]};assert.equal(campaignIncident(s,'john',row({adAccountId:'another',externalId:'another'}))?.id,incident.id);assert.equal(campaignIncident(s,'gabe',row()),null);
 }
 const scoped={incidents:[{...incident,scope:{accountIds:['account'],objectIds:[]}}]};assert.equal(campaignIncident(scoped,'john',row())?.id,incident.id);assert.equal(campaignIncident(scoped,'john',row({adAccountId:'other'})),null);
 for(const scope of [{accountIds:'account',objectIds:[]},{accountIds:[],objectIds:'c'},{accountIds:[null],objectIds:[]},{accountIds:[],objectIds:[{objectId:'c'}]}])assert.equal(campaignIncident({incidents:[{...incident,scope}]},'john',row()),null);
});
test('ending an incident requires a fresh review marker while it is no longer active',()=>{
 const incident={id:'closed',project:'john',status:'Encerrado',reportedAt:'2026-11-03T17:50:00Z',scope:{accountIds:[],objectIds:[]}},s={incidents:[incident]};
 assert.equal(campaignIncident(s,'john',row()),null);assert.deepEqual(campaignReviewMarker(s,'john',row()),{kind:'incident',id:'closed',at:incident.reportedAt,incident});
});
test('native drift compares known fields only for one exact Meta campaign identity',()=>{
 const before=row(),after=row({status:'ACTIVE',dailyBudget:150,budgetCurrency:'USD'});
 assert.deepEqual(campaignNativeDrift(before,after),[{field:'status',before:'PAUSED',after:'ACTIVE'},{field:'dailyBudget',before:100,after:150},{field:'budgetCurrency',before:'BRL',after:'USD'}]);
 for(const patch of [{adAccountId:'other'},{externalId:'other'},{provider:'google'},{level:'adset'}])assert.deepEqual(campaignNativeDrift(before,{...after,...patch}),[]);
 assert.deepEqual(campaignNativeDrift(row({dailyBudget:null,status:undefined}),row({dailyBudget:150,status:'ACTIVE'})),[]);
 assert.deepEqual(campaignNativeDrift(null,after),[]);assert.deepEqual(campaignNativeDrift(before,null),[]);
});
