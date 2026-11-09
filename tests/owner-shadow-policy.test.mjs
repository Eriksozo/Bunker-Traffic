import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {ownerShadowPolicy} from '../lib/autonomy-shadow.mjs';
import {first24hGuard,first24hReason} from '../lib/first-24h.mjs';

// Owner decision of 09/11/2026: align the Sombra with his own pauses. Values here are test values, not the real ones.
const zero={frontOrders:0,orders:0,revenueNet:0};

test('Owner layer only lowers thresholds, enables listed projects and keeps disabled ones off',()=>{
 const base={projects:{a:{pauseTestMinSpend:270,other:5},b:{pauseTestMinSpend:50},off:{enabled:false}}};
 const owner={all:{first24hLowIcPauseAt:80,pauseTestMinSpend:140},enable:['c','off']};
 const out=ownerShadowPolicy(base,owner,['a','b','c','d','off']);
 assert.deepEqual(out.projects.a,{pauseTestMinSpend:140,other:5,first24hLowIcPauseAt:80},'lowered, other fields kept');
 assert.equal(out.projects.b.pauseTestMinSpend,50,'never raised above a lower project value');
 assert.deepEqual(out.projects.c,{first24hLowIcPauseAt:80,pauseTestMinSpend:140},'listed project starts with the owner values');
 assert.equal(out.projects.d,undefined,'a project neither configured nor listed stays out');
 assert.deepEqual(out.projects.off,{enabled:false},'a disabled project stays disabled');
 assert.equal(base.projects.a.pauseTestMinSpend,270,'the input is never changed');
 assert.equal(ownerShadowPolicy(base,{enable:['x']},['x']).projects.x.first24hLowIcPauseAt,undefined);
 assert.deepEqual(ownerShadowPolicy(base,null,['a']).projects.a,base.projects.a,'no owner layer: same policy');
 assert.deepEqual(ownerShadowPolicy(base,{all:{pauseTestMinSpend:-1,first24hLowIcPauseAt:'80'}},['a']).projects.a,base.projects.a,'invalid values ignored');
 assert.equal(ownerShadowPolicy(base,{enable:['zz']},['a']).projects.zz,undefined,'only configured projects can be enabled');
});

test('Earlier pause point: 0–1 IC pauses from the owner value, the ceiling and its text stay',()=>{
 const p={first24hLowIcPauseAt:80};
 const g=first24hGuard({spend:81,checkouts:1,...zero},p);
 assert.deepEqual([g.level,g.limit,g.pauseAt],['pause',110,80]);
 assert.equal(first24hGuard({spend:79,checkouts:0,...zero},p).level,'alert','just before the pause point: alert');
 assert.equal(first24hGuard({spend:60,checkouts:0,...zero},p).level,'watch');
 assert.match(first24hReason({stage:'first-day'},g),/Teto R\$110 com até 1 IC; pausa a partir de R\$80\./);
 assert.equal(first24hGuard({spend:95,checkouts:1,...zero},{first24hLowIcPauseAt:200}).pauseAt,99,'never later than 90% of the ceiling');
 const d=first24hGuard({spend:80,checkouts:1,...zero},{});
 assert.deepEqual([d.level,d.pauseAt],['alert',99],'default unchanged: alert from R$77, pause from R$99');
 const two=first24hGuard({spend:141,checkouts:2,...zero},{pauseTestMinSpend:140});
 assert.deepEqual([two.level,two.limit],['over',140],'2+ IC: the project limit');
});

test('The executor reads the owner layer for the Sombra and the first-24h board',()=>{
 const src=fs.readFileSync(new URL('../worker/cloud-executor.ts',import.meta.url),'utf8');
 assert.equal((src.match(/AUTONOMY_SHADOW_POLICY/g)||[]).length,1,'one place parses the policy');
 assert.match(src,/AUTONOMY_SHADOW_OWNER/);
 assert.equal((src.match(/this\.shadowPolicyFor\(state\)/g)||[]).length,2,'the Sombra and the board use the same layered policy');
});
