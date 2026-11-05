import test from 'node:test';
import assert from 'node:assert/strict';
import {creativeLearningContext} from '../lib/creative-learning-context.mjs';
const now=Date.parse('2026-11-05T12:00:00Z');
function fixture(){
 const row={id:'piece',kind:'variant',name:'JHON_043_H1_V01',metaName:'JHON_043_H1_V01',status:'Publicado',origin:'original-piece',expert:'JHON',sourceUpdatedAt:null};
 const state={config:{p:{projectName:'John'},q:{projectName:'Nico'}},snapshots:[{projectId:'p',level:'ad',rows:[{name:row.name,adAccountId:'a',campaignExternalId:'c'}]}]},data={items:[{projectId:'p',error:null,snapshot:{source:'Órbita MCP',projectId:'p',projectName:'John',coverage:'returned-items-only',fetchedAt:new Date(now-1000).toISOString(),binding:{squad:'SQ1',expertId:'expert',expertSigla:'JHON'},rows:[row]}}]};
 return {state,data,focus:[{adAccountId:'a',externalId:'c'}],row};
}
test('Fresh exact Órbita identity enriches a scoped Meta ad without inventing performance',()=>{
 const {state,data,focus}=fixture(),before=structuredClone(data),context=creativeLearningContext(state,'p',data,focus,now);assert.equal(context.available,true);assert.equal(context.matches.length,1);assert.equal(context.matches[0].origin,'original-piece');assert.equal(context.financialEvidence,false);assert.equal(context.matches[0].revenue,undefined);assert.deepEqual(data,before);
});
test('Missing, stale, foreign and failed metadata remain unavailable rather than empty successful reads',()=>{
 const {state,data,focus}=fixture();assert.equal(creativeLearningContext(state,'p',{},focus,now).available,false);
 for(const change of [d=>d.items[0].snapshot.projectName='Nico',d=>d.items[0].snapshot.fetchedAt=new Date(now-600001).toISOString(),d=>d.items[0].error={code:'ORBITA_UNAVAILABLE'},d=>d.items.push(structuredClone(d.items[0]))]){const d=structuredClone(data);change(d);assert.equal(creativeLearningContext(state,'p',d,focus,now).available,false);}
 assert.equal(creativeLearningContext(state,'q',data,focus,now).available,false);
});
test('Names are not collapsed by suffix guessing, and duplicate or foreign expert identities do not link',()=>{
 const {state,data,focus,row}=fixture();state.snapshots[0].rows[0].name='JHON_043_H1_V02';assert.equal(creativeLearningContext(state,'p',data,focus,now).matches.length,0);
 state.snapshots[0].rows[0].name=row.name;data.items[0].snapshot.rows.push({...row,id:'other'});const c=creativeLearningContext(state,'p',data,focus,now);assert.equal(c.ambiguousNames,1);assert.equal(c.matches.length,0);
 data.items[0].snapshot.rows=[{...row,expert:'NICO'}];assert.equal(creativeLearningContext(state,'p',data,focus,now).matches.length,0);
});
