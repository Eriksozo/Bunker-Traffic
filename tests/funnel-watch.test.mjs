import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {vigiaPolicy,ordersFacts,checkoutFacts,videoFacts,pageFacts,liveSpend,probePage,evaluateProject,vigiaAlerts,rememberVigia,
 validDiscordWebhook,discordPayload,sendDiscord,runVigia,vigiaStatus,addSample,trafficState} from '../lib/funnel-watch.mjs';
import {scrubRead,cloudReadTools,cloudWriteTools} from '../lib/cloud-malva.mjs';

const H=3600000,NOW=Date.parse('2026-11-13T18:00:00.000Z'); // 15:00 in São Paulo
const iso=t=>new Date(t).toISOString();
const WEBHOOK='https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz_ABCDEFG-123';
const project={id:'e77d5763-1022-4e00-a3b0-330a30683b51',name:'Murilo'};
const snapshot=(spend,at=NOW,rows=null)=>({projectId:project.id,snapshot:{projectId:project.id,projectName:'Murilo',source:'Malva MCP',period:'today',level:'campaign',complete:true,
 timezone:'America/Sao_Paulo',from:'2026-11-13T03:00:00.000Z',to:'2026-11-14T03:00:00.000Z',fetchedAt:iso(at-60000),lastSyncAt:null,
 rows:rows||[{name:'10/11 - [CBO] - [MURI] - [PRE]',spend},{name:'[ENGAJAMENTO] perfil',spend:50}]}});
const response=(status,headers={})=>({ok:status>=200&&status<300,status,headers:new Headers(headers),body:null});

test('facts: last approved sale, checkout webhook, vTurb and front pages; missing data stays N/D', ()=>{
 const o=ordersFacts({items:[{approvedAt:iso(NOW-4*H),status:'approved'}],totals:{approved:13}});
 assert.equal(o.lastSaleAt,iso(NOW-4*H));assert.equal(o.approvedToday,13);
 assert.equal(ordersFacts({items:[],totals:{approved:0}},{items:[]}).lastSaleAt,null);
 assert.deepEqual(checkoutFacts({items:[{active:true,lastEventAt:iso(NOW-H)},{active:false,lastEventAt:iso(NOW)},{active:true,lastEventAt:null}]}),{integrations:2,lastEventAt:iso(NOW-H)});
 assert.deepEqual(videoFacts({sources:1,totals:{conversions:10}}),{vturbConversions:10,videoSources:1});
 assert.equal(videoFacts({sources:0,totals:{conversions:0}}).vturbConversions,null);
 const p=pageFacts({rows:[{host:'cl.projetosynka.com',path:'/89k1inkeec',visitors:424,checkouts:40},{host:'inteligenciasynka.com',path:'/obrigado',visitors:65,checkouts:0},
  {host:'inteligenciasynka.com',path:'/white-rabbit',visitors:70,checkouts:8},{host:'bad host',path:'/x',visitors:9,checkouts:3}]});
 assert.deepEqual(p.front.map(f=>f.url),['https://cl.projetosynka.com/89k1inkeec','https://inteligenciasynka.com/white-rabbit']);
 assert.equal(p.visitors,568);assert.equal(p.checkouts,51);
 assert.equal(pageFacts({rows:[{host:'a.com',path:'/',visitors:3}]}).checkouts,null);
});

test('spend today excludes warm-up/engagement, and a stale or other-day read is N/D', ()=>{
 assert.equal(liveSpend([snapshot(320)],project.id,{now:NOW}).spend,320);
 assert.equal(liveSpend([snapshot(320,NOW-30*60000)],project.id,{now:NOW}),null);
 assert.equal(liveSpend([snapshot(320)],project.id,{now:NOW+24*H}),null);
 assert.equal(liveSpend([snapshot(320,NOW,[{name:'x',spend:'abc'}])],project.id,{now:NOW}),null);
});

test('pages: protected answers are N/D, never "down"; 5xx, 404 and network failures are failures', async()=>{
 assert.equal((await probePage(async()=>response(200),'https://a.com/')).ok,true);
 assert.equal((await probePage(async()=>response(403),'https://a.com/')).ok,null);
 assert.equal((await probePage(async()=>response(503,{'cf-mitigated':'challenge'}),'https://a.com/')).ok,null);
 assert.equal((await probePage(async()=>response(502),'https://a.com/')).ok,false);
 assert.equal((await probePage(async()=>response(404),'https://a.com/')).ok,false);
 const net=await probePage(async()=>{throw new TypeError('x');},'https://a.com/');assert.equal(net.ok,false);assert.equal(net.code,'sem resposta');
});

// History with the traffic spending: one sample 40 min ago and one 3.5 h ago, same day.
const history=[{at:iso(NOW-3.5*H),day:'2026-11-13',spend:100,visitors:300,checkouts:30,approved:13},{at:iso(NOW-40*60000),day:'2026-11-13',spend:280,visitors:500,checkouts:38,approved:13}];
const sample={at:iso(NOW),day:'2026-11-13',spend:320,visitors:568,checkouts:40,approved:13};
const ok=[{url:'https://cl.projetosynka.com/89k1inkeec',ok:true,status:200}];

test('"sem venda há 4h" only with the traffic running, with the slide\'s three checks', ()=>{
 const orders={lastSaleAt:iso(NOW-4*H-5*60000),approvedToday:13,searched:'today'};
 const e=evaluateProject({project,sample,history,orders,checkout:{integrations:1,lastEventAt:iso(NOW-10*60000)},video:{vturbConversions:12},pages:ok,now:NOW});
 const s=e.signals.find(x=>x.kind==='nosale');
 assert.equal(s.title,'Murilo: sem venda há 4h');
 assert.equal(s.lines[0],'Página no ar ✓ · Checkout abrindo ✓ · Tráfego rodando ✓');
 assert.match(s.lines[1],/Última venda às 10:55 · R\$\s?40,00 gastos na última hora/);
 assert.match(s.lines.at(-1),/Funil de pé/);
 // Same outage, no spend in the last hour: quiet.
 const idle=evaluateProject({project,sample:{...sample,spend:280},history,orders,checkout:null,video:null,pages:ok,now:NOW});
 assert.equal(idle.signals.some(x=>x.kind==='nosale'),false);
 // Under 3 h: quiet. Failed orders read: quiet (never alerted on missing data).
 assert.equal(evaluateProject({project,sample,history,orders:{...orders,lastSaleAt:iso(NOW-2*H)},pages:ok,now:NOW}).signals.length,0);
 assert.equal(evaluateProject({project,sample,history,orders:null,pages:ok,now:NOW}).signals.length,0);
 // No sale in the 3-day lookup.
 const none=evaluateProject({project,sample,history,orders:{lastSaleAt:null,approvedToday:0,searched:'3d'},pages:ok,now:NOW});
 assert.equal(none.signals[0].title,'Murilo: sem venda nos últimos 3 dias');
});

test('the first failed check leads the hint: page, then a silent webhook, then nobody at the checkout', ()=>{
 const orders={lastSaleAt:iso(NOW-4*H),approvedToday:13,searched:'today'};
 const down=[{url:'https://cl.projetosynka.com/89k1inkeec',ok:false,status:502}];
 const pageDown=evaluateProject({project,sample,history,orders,pages:down,failRuns:{[down[0].url]:2},now:NOW});
 assert.match(pageDown.signals[0].lines[0],/Página no ar ✗/);
 assert.match(pageDown.signals[0].lines.at(-1),/Confere a página: cl\.projetosynka\.com\/89k1inkeec \(502\)/);
 assert.equal(pageDown.signals.find(x=>x.kind==='page').title,'Murilo: página fora do ar');
 // One failed read is not "down" yet.
 assert.equal(evaluateProject({project,sample,history,orders,pages:down,failRuns:{[down[0].url]:1},now:NOW}).signals.some(x=>x.kind==='page'),false);
 const silent=evaluateProject({project,sample,history,orders,checkout:{integrations:1,lastEventAt:iso(NOW-5*H)},pages:ok,now:NOW});
 assert.match(silent.signals[0].lines.at(-1),/webhook não recebe aviso desde 10:00/);
 const flat=[{...history[0],checkouts:40},{...history[1],checkouts:40}];
 const nobody=evaluateProject({project,sample,history:flat,orders,checkout:{integrations:1,lastEventAt:iso(NOW-10*60000)},pages:ok,now:NOW});
 assert.match(nobody.signals[0].lines[0],/Checkout abrindo ✗/);assert.match(nobody.signals[0].lines.at(-1),/ninguém iniciou checkout/);
});

test('"as vendas não batem" from 3 more vTurb conversions than approved sales; grows in steps of 3', ()=>{
 const orders={lastSaleAt:iso(NOW-H),approvedToday:3,searched:'today'};
 const two=evaluateProject({project,sample,history,orders,video:{vturbConversions:5},pages:ok,now:NOW});
 assert.equal(two.signals.length,0);
 const three=evaluateProject({project,sample,history,orders,checkout:{integrations:1,lastEventAt:iso(NOW-2*H)},video:{vturbConversions:6},pages:ok,now:NOW}).signals[0];
 assert.equal(three.title,'Murilo: as vendas não batem');
 assert.equal(three.lines[0],'O vTurb marcou 6 vendas hoje e o checkout aprovou 3. Confira o webhook.');
 const six=evaluateProject({project,sample,history,orders,video:{vturbConversions:9},pages:ok,now:NOW}).signals[0];
 assert.notEqual(three.key,six.key);
});

test('traffic: a sample 20–60 min old proves "running"; without one, spend today is not a proof', ()=>{
 assert.equal(trafficState(history,sample).running,true);
 assert.equal(trafficState([],sample).running,null);
 assert.equal(trafficState([],{...sample,spend:0}).running,false);
 assert.equal(addSample(history,sample,{now:NOW}).length,3);
 assert.equal(addSample(history,sample,{now:NOW+8*H}).length,1);
});

test('ledger: "VIGIA ligado" once, each alert once, repeat every 3 h of the same outage, "voltou a vender" after an alert', ()=>{
 const orders={lastSaleAt:iso(NOW-4*H),approvedToday:13,searched:'today'};
 const ev=(o,now=NOW)=>[{project,...evaluateProject({project,sample:{...sample,at:iso(now)},history:[{...history[1],at:iso(now-40*60000)}],orders:o,pages:ok,now})}];
 let r=vigiaAlerts(ev(orders),null,{now:NOW,projects:[project]});
 assert.deepEqual(r.fresh.map(a=>a.kind),['hello','nosale']);
 let ledger=rememberVigia(null,r.fresh,{now:NOW,keep:r.present});
 assert.equal(vigiaAlerts(ev(orders),ledger,{now:NOW}).fresh.length,0);
 // 6 h without a sale: the second 3-hour bucket rings again.
 assert.equal(vigiaAlerts(ev(orders,NOW+2*H),ledger,{now:NOW+2*H}).fresh[0].kind,'nosale');
 const back=vigiaAlerts(ev({...orders,lastSaleAt:iso(NOW+10*60000)},NOW+15*60000),ledger,{now:NOW+15*60000}).fresh;
 assert.equal(back[0].title,'Murilo: voltou a vender');assert.match(back[0].lines[0],/depois de 4h10 sem venda/);
 ledger=rememberVigia(ledger,back,{now:NOW});assert.equal(ledger.open[project.id],undefined);
});

test('Discord: only webhook addresses, mentions disabled, 429/5xx retried and other 4xx not', async()=>{
 assert.equal(validDiscordWebhook(WEBHOOK),true);
 for(const bad of [null,'','http://discord.com/api/webhooks/1/abc','https://evil.com/api/webhooks/123456/abcdefghijklmnopqrstuv','https://discord.com/channels/1/2'])assert.equal(validDiscordWebhook(bad),false);
 const p=discordPayload({title:'Murilo: sem venda há 4h',lines:['a','@everyone b'],color:1});
 assert.deepEqual(p.allowed_mentions,{parse:[]});assert.equal(p.username,'VIGIA');assert.equal(p.embeds[0].description,'a\n@everyone b');
 assert.deepEqual(await sendDiscord(async()=>response(204),WEBHOOK,{title:'x'}),{ok:true});
 assert.equal((await sendDiscord(async()=>response(429),WEBHOOK,{title:'x'})).retry,true);
 assert.equal((await sendDiscord(async()=>response(404),WEBHOOK,{title:'x'})).retry,false);
 const net=await sendDiscord(async()=>{throw new Error(WEBHOOK);},WEBHOOK,{title:'x'});
 assert.equal(JSON.stringify(net).includes('webhooks'),false);
});

function fakeMalva({lastSaleAt=iso(NOW-4*H),approved=13,vturb=10,fail={}}={}){
 const calls=[];
 const read=async(tool,args)=>{calls.push([tool,args]);if(fail[tool])throw Object.assign(new Error('x'),{code:fail[tool]});
  if(tool==='tracking_orders')return {items:args.preset==='today'&&lastSaleAt?[{status:'approved',approvedAt:lastSaleAt}]:[],totals:{approved}};
  if(tool==='tracking_checkout_integrations')return {items:[{active:true,lastEventAt:iso(NOW-20*60000)}]};
  if(tool==='tracking_videos')return {sources:1,totals:{conversions:vturb}};
  if(tool==='tracking_pages')return {rows:[{host:'cl.projetosynka.com',path:'/89k1inkeec',visitors:568,checkouts:40}]};
  throw new Error('unexpected '+tool);};
 return {read,calls};
}

test('one VIGIA read: only allowlisted reads, a preview without the webhook, Discord once with it', async()=>{
 const malva=fakeMalva(),sent=[];
 const fetchFn=async(url,init)=>{if(init?.method==='POST'){sent.push(JSON.parse(init.body));return response(204);}return response(200);};
 const prior={version:vigiaPolicy.version,history:{[project.id]:history}};
 const off=await runVigia({projects:[project],read:malva.read,fetchFn,liveItems:[snapshot(370)],prior,webhook:null,now:NOW});
 assert.equal(sent.length,0);assert.equal(off.state.configured,false);assert.equal(off.state.preview[0].title,'Murilo: sem venda há 4h');
 for(const [tool] of malva.calls){assert.ok(cloudReadTools.includes(tool));assert.ok(!cloudWriteTools.includes(tool));}
 const on=await runVigia({projects:[project],read:malva.read,fetchFn,liveItems:[snapshot(370)],prior,webhook:WEBHOOK,now:NOW});
 assert.deepEqual(sent.map(p=>p.embeds[0].title),['VIGIA ligado','Murilo: sem venda há 4h']);
 assert.equal(on.state.sent,2);assert.equal(on.state.pending,0);
 const again=await runVigia({projects:[project],read:malva.read,fetchFn,liveItems:[snapshot(380)],prior:on.state,webhook:WEBHOOK,now:NOW+vigiaPolicy.readMs});
 assert.equal(again.sent,0);
 const st=vigiaStatus(on.state);assert.equal(st.configured,true);assert.equal(st.projects[0].name,'Murilo');
 assert.equal(JSON.stringify(on.state).includes('discord.com'),false);
});

test('a failed read is reported per project and never becomes "sem venda"; a 429 stays pending for the next read', async()=>{
 const malva=fakeMalva({fail:{tracking_orders:'MCP_UNAVAILABLE'}});
 const r=await runVigia({projects:[project],read:malva.read,fetchFn:async()=>response(200),liveItems:[snapshot(370)],prior:{version:1,history:{[project.id]:history}},webhook:null,now:NOW});
 assert.equal(r.state.errors.Murilo.orders,'MCP_UNAVAILABLE');assert.equal(r.state.preview.length,0);
 const busy=await runVigia({projects:[project],read:fakeMalva().read,fetchFn:async(u,i)=>i?.method==='POST'?response(429):response(200),liveItems:[snapshot(370)],prior:{version:1,history:{[project.id]:history}},webhook:WEBHOOK,now:NOW});
 assert.equal(busy.sent,0);assert.equal(busy.state.lastError,'DISCORD_429');assert.equal(busy.state.ledger.hello,null);
});

test('the Malva bridge strips buyer data from sales and addresses from checkout integrations', ()=>{
 const raw={items:[{id:'o1',status:'approved',approvedAt:'2026-11-13T13:16:45.819Z',value:297,currency:'BRL',provider:'dotpag',customerName:'Fulano',customerEmail:'f@x.com',customerPhone:'55',customerDocument:'1',visitorId:'v',transactionId:'t',utm:{campaign:'c'},affiliateEmail:'a@x.com'}],
  totals:{approved:13},origins:{affiliates:[{value:'a@x.com'}]},nextCursor:'abc'};
 const out=scrubRead('tracking_orders',raw);
 assert.deepEqual(out.items[0],{status:'approved',approvedAt:'2026-11-13T13:16:45.819Z',value:297,currency:'BRL',provider:'dotpag'});
 assert.equal(out.origins,undefined);assert.equal(out.nextCursor,undefined);assert.deepEqual(out.totals,{approved:13});
 assert.equal(JSON.stringify(out).includes('@'),false);
 assert.deepEqual(scrubRead('tracking_checkout_integrations',{items:[{id:'i',webhookUrl:'https://x/secret',postbackUrl:'y',active:true}]}).items[0],{id:'i',active:true});
 assert.deepEqual(scrubRead('tracking_orders',{ok:true}),{ok:true});
 // The executor and the Supabase function run the same bridge.
 assert.equal(readFileSync(new URL('../lib/cloud-malva.mjs',import.meta.url),'utf8'),readFileSync(new URL('../supabase/functions/malva-mcp/cloud-malva.mjs',import.meta.url),'utf8'));
});

test('VIGIA never writes: no Malva write tool, no central, no Meta in the module', ()=>{
 const src=readFileSync(new URL('../lib/funnel-watch.mjs',import.meta.url),'utf8');
 for(const w of ['tracking_set_ad_budget','tracking_set_ad_status','graph.facebook.com','commitPersistedState','bunker_store'])assert.equal(src.includes(w),false,w);
});
