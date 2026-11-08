import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyOwnerDeviceRequest,ownerDeviceKeyId,OWNER_DEVICE_AUDIENCE} from '../lib/owner-device.mjs';
import {cloudflareAuth} from '../lib/cloudflare-auth.mjs';
import {companionCards} from '../lib/companion-cards.mjs';
const b64=bytes=>Buffer.from(bytes).toString('base64');
async function device(){
 const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
 const raw=new Uint8Array(await crypto.subtle.exportKey('raw',pair.publicKey));
 return {pair,publicKey:b64(raw),keyId:await ownerDeviceKeyId(raw)};
}
async function envelope(d,input,{iat=Date.now(),aud=OWNER_DEVICE_AUDIENCE,key=d.keyId,tamper=false}={}){
 const payload=new TextEncoder().encode(JSON.stringify({aud,iat,input}));
 const sig=new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},d.pair.privateKey,payload));
 if(tamper)sig[5]^=1;
 return JSON.stringify({v:1,key,payload:b64(payload),sig:b64(sig)});
}
const decision={op:'cardDecision',revision:7,clientId:'notch-owner-0001',project:'p1',cardId:'campaign:p1:1:2',signature:'v1-x',choice:'pause',reason:''};
test('a Touch ID signature from the registered Mac yields only the signed owner input',async()=>{
 const d=await device(),result=await verifyOwnerDeviceRequest(await envelope(d,decision),d.publicKey);
 assert.deepEqual(result.input,decision);assert.equal(result.ownerId,'mac-touchid:'+d.keyId);
});
test('tampered, foreign, stale, wrong-audience and unsupported requests fail closed',async()=>{
 const d=await device(),other=await device();
 const codes=async(body,key=d.publicKey)=>{try{await verifyOwnerDeviceRequest(body,key);return 'ok';}catch(e){return e.code;}};
 assert.equal(await codes(await envelope(d,decision,{tamper:true})),'OWNER_DEVICE_SIGNATURE');
 assert.equal(await codes(await envelope(other,decision,{key:d.keyId})),'OWNER_DEVICE_SIGNATURE');
 assert.equal(await codes(await envelope(other,decision)),'OWNER_DEVICE_UNKNOWN_KEY');
 assert.equal(await codes(await envelope(d,decision,{iat:Date.now()-121000})),'OWNER_DEVICE_EXPIRED');
 assert.equal(await codes(await envelope(d,decision,{aud:'other'})),'OWNER_DEVICE_FORMAT');
 for(const op of ['collaborationRun','reviewBatch','cardReopen','config','executionSubmit'])assert.equal(await codes(await envelope(d,{...decision,op})),'OWNER_DEVICE_OP');
 assert.equal(await codes(await envelope(d,{...decision,revision:'7'})),'OWNER_DEVICE_FORMAT');
 assert.equal(await codes(await envelope(d,decision),null),'OWNER_DEVICE_UNCONFIGURED');
 assert.equal(await codes(await envelope(d,decision),'AAAA'),'OWNER_DEVICE_UNCONFIGURED');
 assert.equal(await codes('x'.repeat(70000)),'OWNER_DEVICE_LIMIT');
});
const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_ANON_KEY:'public-test',SUPABASE_SERVICE_ROLE_KEY:'server-test',BUNKER_OWNER_EMAIL:'owner@example.com',BUNKER_AGENT_TOKEN:'agent-test'};
test('the boundary forwards a verified Mac decision with a fresh owner-device header and drops forged identity',async()=>{
 const d=await device(),configured={...env,BUNKER_OWNER_DEVICE_KEY:d.publicKey};
 const req=new Request('https://bunker.example/api/companion/owner',{method:'POST',headers:{'x-bunker-owner-device':'mac-touchid:forged','oai-authenticated-user-id':'owner',cookie:'bunker_access=x'},body:await envelope(d,decision)});
 const out=await cloudflareAuth(req,configured);assert.ok(out instanceof Request);
 assert.equal(out.headers.get('x-bunker-owner-device'),'mac-touchid:'+d.keyId);assert.equal(out.headers.get('x-bunker-companion'),'owner');
 assert.equal(out.headers.has('oai-authenticated-user-id'),false);assert.equal(out.headers.has('cookie'),false);
 assert.deepEqual(JSON.parse(await out.text()),decision);
 const refused=await cloudflareAuth(new Request('https://bunker.example/api/companion/owner',{method:'POST',body:await envelope(d,decision,{tamper:true})}),configured);
 assert.equal(refused.status,401);assert.equal((await refused.json()).code,'OWNER_DEVICE_SIGNATURE');
 assert.equal((await cloudflareAuth(new Request('https://bunker.example/api/companion/owner',{method:'POST',body:await envelope(d,decision)}),env)).status,503);
 assert.equal((await cloudflareAuth(new Request('https://bunker.example/api/companion/owner'),configured)).status,405);
});
test('forged owner-device headers never reach other routes and the read credential reaches the cards view only by GET',async(t)=>{
 t.mock.method(globalThis,'fetch',async()=>Response.json({id:'owner-id',email:env.BUNKER_OWNER_EMAIL,email_confirmed_at:'2026-11-03'}));
 const out=await cloudflareAuth(new Request('https://bunker.example/api/state',{headers:{cookie:'bunker_access=t','x-bunker-owner-device':'mac-touchid:forged','x-bunker-companion':'owner'}}),env);
 assert.ok(out instanceof Request);assert.equal(out.headers.has('x-bunker-owner-device'),false);assert.equal(out.headers.has('x-bunker-companion'),false);
 const token='c'.repeat(43),configured={...env,BUNKER_COMPANION_TOKEN:token};
 const cards=await cloudflareAuth(new Request('https://bunker.example/api/companion/cards?project=p1',{headers:{Authorization:'Bearer '+token}}),configured);
 assert.ok(cards instanceof Request);assert.equal(cards.headers.get('x-bunker-companion'),'read');assert.equal(cards.headers.has('authorization'),false);
 assert.equal((await cloudflareAuth(new Request('https://bunker.example/api/companion/cards',{headers:{Authorization:'Bearer wrong'}}),configured)).status,401);
 const pulse=await cloudflareAuth(new Request('https://bunker.example/api/companion/pulse',{headers:{Authorization:'Bearer '+token}}),configured);
 assert.ok(pulse instanceof Request);assert.equal(pulse.headers.get('x-bunker-companion'),'read');
});
test('cards view lists only proposals waiting for the owner, scoped to the requested campaign',()=>{
 const later=new Date(Date.now()+3600000).toISOString();
 const proposal=(id,status,objectId)=>({id,version:1,signature:'s-'+id,status,project:'p1',expiresAt:later,reviews:[],payload:{title:'Pausar',action:'status',level:'campaign',adAccountId:'a1',objectId,objectName:'Camp '+objectId,accountName:'CA',currency:'USD',before:{status:'ACTIVE'},after:{status:'PAUSED'}}});
 const state={config:{p1:{projectName:'John'}},snapshots:[],proposals:[proposal('x','Aguardando aprovação','c1'),proposal('y','Em revisão','c1'),proposal('z','Aguardando aprovação','c2')]};
 const view=companionCards(state,{project:'p1',objectId:'c1'},12);
 assert.equal(view.revision,12);assert.deepEqual(view.approvals.map(a=>a.id),['x']);
 assert.equal(view.approvals[0].projectName,'John');assert.equal(view.approvals[0].after.status,'PAUSED');assert.equal(view.approvals[0].before.dailyBudget,null);
 assert.equal(companionCards(state,{project:'other'}).approvals.length,0);
});
test('signature envelope probes: future clock, bad padding, wrong lengths and malformed inputs all get fixed codes',async()=>{
 const d=await device();
 const codes=async body=>{try{await verifyOwnerDeviceRequest(body,d.publicKey);return 'ok';}catch(e){return e.code||'UNCODED:'+e.name;}};
 assert.equal(await codes(await envelope(d,decision,{iat:Date.now()+121000})),'OWNER_DEVICE_EXPIRED','a clock far ahead is refused too');
 assert.equal(await codes(await envelope(d,decision,{iat:Date.now()+60000})),'ok','small skew accepted');
 assert.equal(await codes(await envelope(d,decision,{iat:1.5})),'OWNER_DEVICE_FORMAT');
 const good=JSON.parse(await envelope(d,decision));
 assert.equal(await codes(JSON.stringify({...good,sig:'A'})),'OWNER_DEVICE_FORMAT','invalid base64 length never escapes uncoded');
 assert.equal(await codes(JSON.stringify({...good,sig:Buffer.alloc(65).toString('base64')})),'OWNER_DEVICE_SIGNATURE');
 assert.equal(await codes(JSON.stringify({...good,payload:'not base64!'})),'OWNER_DEVICE_FORMAT');
 assert.equal(await codes(JSON.stringify({...good,v:2})),'OWNER_DEVICE_FORMAT');
 assert.equal(await codes('[]'),'OWNER_DEVICE_FORMAT');assert.equal(await codes('null'),'OWNER_DEVICE_FORMAT');
 for(const clientId of ['short','has space here','x'.repeat(151),42])assert.equal(await codes(await envelope(d,{...decision,clientId})),'OWNER_DEVICE_FORMAT',String(clientId));
 assert.equal(await codes(await envelope(d,[decision])),'OWNER_DEVICE_OP','an array is not one owner input');
 const raw=Buffer.from(d.publicKey,'base64');raw[0]=2;
 try{await verifyOwnerDeviceRequest(await envelope(d,decision),raw.toString('base64'));assert.fail('compressed key accepted');}catch(e){assert.equal(e.code,'OWNER_DEVICE_UNCONFIGURED');}
});
