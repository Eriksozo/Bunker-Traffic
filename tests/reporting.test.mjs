import test from 'node:test';
import assert from 'node:assert/strict';
import {appliedInWindow,verifyDecision} from '../lib/reporting.mjs';
test('Report never presents old or other-client applications as current work',()=>{
 const w={from:'2026-11-02T03:00:00Z',to:'2026-11-03T03:00:00Z'},now=Date.parse('2026-11-02T16:00:00Z');
 const d={project:'john',status:'Aplicada pelo operador'};
 const rows=[{...d,id:'today',appliedAt:'2026-11-02T12:00:00Z'},{...d,id:'old',appliedAt:'2026-11-01T12:00:00Z'},{...d,id:'other',project:'nico',appliedAt:'2026-11-02T12:00:00Z'},{...d,id:'legacy',updatedAt:'2026-11-02T12:00:00Z'},{...d,id:'future',appliedAt:'2026-11-02T18:00:00Z'}];
 assert.deepEqual(appliedInWindow(rows,'john',w,now).map(r=>r.id),['today']);
});
test('Only approved and confirmed applications receive an immutable verification time',()=>{
 const d={status:'Proposta'};assert.throws(()=>verifyDecision(d,'Aplicada pelo operador',true,'first'));assert.equal(d.appliedAt,undefined);
 verifyDecision(d,'Aprovada',false,'approved');assert.throws(()=>verifyDecision(d,'Aplicada pelo operador',false,'bad'));
 verifyDecision(d,'Aplicada pelo operador',true,'first');assert.equal(d.appliedAt,'first');assert.equal(verifyDecision(d,'Aplicada pelo operador',true,'second'),false);assert.equal(d.appliedAt,'first');assert.throws(()=>verifyDecision(d,'Proposta',false,'reopened'));
});
