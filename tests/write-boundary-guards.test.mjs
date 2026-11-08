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
