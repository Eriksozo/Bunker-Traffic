import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {readMetaAccountCampaigns} from '../lib/meta-live.mjs';
import {readMetaAccounts} from '../lib/account-limits.mjs';
import {cloudWriteTools} from '../lib/cloud-malva.mjs';

const root=new URL('../',import.meta.url),read=p=>readFileSync(new URL(p,root),'utf8');

test('Every edge-function copy of a lib module is byte-identical to the tested source', () => {
 const fns=readdirSync(new URL('supabase/functions/',root));let checked=0;
 for(const fn of fns)for(const file of readdirSync(new URL(`supabase/functions/${fn}/`,root)).filter(f=>f.endsWith('.mjs'))){
  if(!existsSync(new URL('lib/'+file,root)))continue;checked++;
  assert.equal(read(`supabase/functions/${fn}/${file}`),read('lib/'+file),`${fn}/${file} drifted from lib/${file}`);
 }
 assert.ok(checked>=7,'copies were found');
 const auth=fns.filter(fn=>existsSync(new URL(`supabase/functions/${fn}/server-auth.mjs`,root))).map(fn=>read(`supabase/functions/${fn}/server-auth.mjs`));
 assert.ok(auth.length>=3);assert.ok(auth.every(a=>a===auth[0]),'server-auth copies agree');
});

test('The Meta tokens are read-only: every Graph call is a GET to graph.facebook.com', async () => {
 const calls=[];const fake=async(url,init={})=>{calls.push({url,method:init.method||'GET'});return {ok:true,status:200,json:async()=>({data:[]})};};
 await readMetaAccountCampaigns(fake,'token',[{account:'123456',ids:['1234567']}]);
 await readMetaAccounts(fake,'token');
 assert.ok(calls.length>=2);
 for(const c of calls){assert.equal(c.method,'GET');assert.equal(new URL(c.url).host,'graph.facebook.com');}
 for(const f of ['lib/meta-live.mjs','lib/account-limits.mjs'])assert.doesNotMatch(read(f),/method\s*:\s*['"](POST|PUT|PATCH|DELETE)/i,f);
});

test('The only provider write tools are daily budget and status', () => {
 assert.deepEqual([...cloudWriteTools].sort(),['tracking_set_ad_budget','tracking_set_ad_status']);
 assert.equal(Object.isFrozen(cloudWriteTools),true);
 for(const f of ['lib/autonomy-shadow.mjs','lib/first-24h.mjs','lib/budget-pace.mjs','lib/owner-orders.mjs','lib/sales-feed.mjs','lib/owner-applied.mjs'])
  assert.doesNotMatch(read(f),/tracking_set_|\.dispatch\(|fetch\(/,`${f} must stay read-only`);
});

// Modo Gestor, Phase 1 (docs/AUTONOMIA-V2-CONTRATO-2026-11-10.md, 0.1): no new write op to the central, GET-only route,
// read-only read model, and the runner reaches only its own `pb:`/`pbs:` keys.
test('Modo Gestor adds no write: the only owner autonomy saves stay autonomyConfig / autonomyKill', () => {
 const state=read('app/api/state/route.ts');
 assert.deepEqual([...new Set(state.match(/autonomy[A-Z][A-Za-z]*/g)||[])].sort(),['autonomyConfig','autonomyKill']);
 const route=read('app/api/autonomy/route.ts');
 assert.match(route,/export async function GET\(/);assert.doesNotMatch(route,/export (async )?function (POST|PUT|PATCH|DELETE)\b|method\s*:/,'GET only');
 for(const f of ['lib/autonomy-deep-view.mjs','lib/autonomy-simulate.mjs'])
  assert.doesNotMatch(read(f),/tracking_set_|\.dispatch\(|fetch\(|storage\.(put|delete)|recordAutonomyOrder|setAutonomyConfig|killAutonomy|commitPersistedState|claimExecution|prepareExecution|submitExecution/,`${f} must stay read-only`);
 const exec=read('worker/cloud-executor.ts');
 for(const m of ['autonomyRead','companionAutonomy','storeDeepBase','playbookShadow','playbookLearning','playbookBackfill']){
  const i=exec.indexOf(' private async '+m+'(');assert.ok(i>0,m);const body=exec.slice(i,exec.indexOf('\n }\n',i));
  assert.doesNotMatch(body,/this\.write\(|this\.read\(|commitPersistedState|recordAutonomyOrder|\.dispatch\(|tracking_set_/,m+' never writes the central or a provider');
 }
 // The backfill source refuses every tool but the read-only history, and a third call.
 const bf=exec.slice(exec.indexOf(' private async playbookBackfill('),exec.indexOf(' private deepBaseAt'));
 assert.match(bf,/tool==='tracking_ad_changes'&&\+\+calls<=2\?malva\.read\(tool,args\):Promise\.reject/);
 assert.doesNotMatch(bf,/tracking_list_projects/,'reuses the pulse\'s listing, never lists itself');
 assert.match(exec,/r\.playbookStore\(this\.ctx\.storage\)/,'the runner gets the facade');
 assert.doesNotMatch(exec.replace(/r\.playbookStore\(this\.ctx\.storage\)/g,''),/run(PlaybookShadow|PlaybookLearning|PlaybookBackfill)\(this\.ctx\.storage/,'never the raw storage');
});

test('The runner store facade denies every key outside pb:/pbs:',async()=>{
 const {playbookStore}=await import('../lib/playbook-runner.mjs'),raw={get:async()=>undefined,put:async()=>{},delete:async()=>true,list:async()=>new Map()},s=playbookStore(raw);
 const denied=async p=>{try{await p;return false;}catch(e){return e?.code==='PLAYBOOK_STORE_DENIED'||/PLAYBOOK_STORE_DENIED/.test(String(e?.message));}};
 assert.ok(await denied(s.put({'shadow:x':{}})),'shadow:* write denied');
 assert.ok(await denied(s.put({autonomyLog:[]})),'autonomy* write denied');
 assert.ok(await denied(s.delete(['learn:2026-11-10:p'])),'learn:* delete denied');
 assert.ok(await denied(s.list({prefix:'shadow:',limit:10})),'foreign listing denied');
 assert.ok(await denied(s.list({prefix:'pb:'})),'a listing without a limit is refused');
 for(const k of ['transaction','deleteAll','setAlarm','sync'])assert.equal(typeof s[k],'undefined',k);
});

test('The owner attribution read keeps its shape: the raw Malva actor identity (actorInfo) stays in the executor',()=>{
 const exec=read('worker/cloud-executor.ts'),route=read('app/api/attribution/route.ts');
 const line=exec.split('\n').find(l=>l.includes("input.action==='attribution'"));
 assert.ok(line&&/usableAttributions\(\[\.\.\.list\.values\(\)\]\)\.map\(\(\{actorInfo:_actorInfo,\.\.\.item\}:any\)=>item\)/.test(line),'the executor drops actorInfo from every item');
 assert.match(route,/data\.items\.map\(\(\{actorInfo:_actorInfo,\.\.\.item\}:any\)=>item\)/,'and the route drops it again (an older executor)');
});
