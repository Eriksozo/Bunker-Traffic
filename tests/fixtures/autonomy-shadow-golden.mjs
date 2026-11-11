/**
 * Golden scenarios for the extraction of lib/campaign-context.mjs out of lib/autonomy-shadow.mjs (Modo Gestor, W3).
 * Synthetic fixtures only: identifiers, names and amounts are invented. The outputs of evaluateShadow and first24hWatch
 * over these scenarios were frozen in autonomy-shadow-golden.json with the code BEFORE the extraction; the test asserts
 * the same bytes after it.
 */
const TZ='America/Sao_Paulo',iso=ms=>new Date(ms).toISOString();
const m=(spend,revenueNet=0,front=0,orders=front,checkouts=0,extra={})=>({spend,revenue:revenueNet,revenueNet,adCosts:0,productCost:0,saleTax:0,frontOrders:front,orders,checkouts,impressions:spend>0?1000:0,linkClicks:spend>0?20:0,...extra});
const row=(id,name,metrics,extra={})=>({id:'uuid-'+id,externalId:id,adAccountId:'acc1',accountName:'Conta Fictícia',name,level:'campaign',provider:'meta',status:'ACTIVE',effectiveStatus:'ACTIVE',accountStatus:{active:true},dailyBudget:100,budgetCurrency:'USD',budgetRate:5,lifetimeBudget:null,...metrics,...extra});
const base={projectId:'p',projectName:'Fictício',level:'campaign',source:'Malva MCP',timezone:TZ,complete:true};

/** Local day D (YYYY-MM-DD) starts at 03:00Z in São Paulo. */
const dayStart=d=>Date.parse(d+'T03:00:00.000Z');
const shift=(d,n)=>new Date(Date.parse(d+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);

function rowsFor(D){
 const dd=d=>d.slice(8,10)+'/'+d.slice(5,7);
 const y=shift(D,-1),y2=shift(D,-2),y3=shift(D,-3);
 const today=[
  row('t1',dd(D)+' - [TESTE] A',m(230,0,0,0,3)),
  row('t2',dd(D)+' - [TESTE] B',m(150,0,0,0,2)),
  row('t3',dd(D)+' - [TESTE] C',m(130,0,0,0,0)),
  row('t4',dd(D)+' - [TESTE] D',m(400,297,1,1,6)),
  row('t5',dd(y)+' - [TESTE] E',m(250,0,0,0,2)),
  row('n1',dd(D)+' - NOVA venda',m(420,250,1,1,4)),
  row('n2',dd(D)+' - NOVA alerta',m(380,340,2,2,4)),
  row('g1','Campanha boa 1',m(500,60,0,0,2),{dailyBudget:200}),
  row('g2','Campanha boa 2',m(320,0,0,0,1),{dailyBudget:200}),
  row('g3','ESCALA boa 3',m(520,100,1,1,2),{dailyBudget:200}),
  row('d1','Sem entrega',m(0,0,0,0,0)),
  row('s1','Forte manhã',m(300,1500,3,4,6),{dailyBudget:200}),
  row('s4','Boa manhã',m(400,1100,2,3,6),{dailyBudget:200}),
  row('s2',dd(D)+' - NOVA forte',m(300,900,2,2,5),{dailyBudget:200}),
  row('k1',dd(y)+' - noite pequena',m(5,0,0,0,0),{dailyBudget:100}),
  row('k2',dd(y2)+' - noite grande',m(5,0,0,0,0),{dailyBudget:400}),
  row('k3',dd(y3)+' - noite forte',m(5,0,0,0,0),{dailyBudget:400}),
  row('w1','[AQUECIMENTO] perfil',m(300,0,0,0,0)),
  row('p1','Pausada',m(80,0,0,0,0),{status:'PAUSED',effectiveStatus:'PAUSED'}),
  row('l1','Vitalício',m(300,0,0,0,0),{dailyBudget:null,lifetimeBudget:5000}),
  row('r1','Aumentada hoje',m(400,80,0,0,1),{dailyBudget:200}),
  row('b1','Real BRL',m(500,0,0,0,1),{dailyBudget:800,budgetCurrency:'BRL',budgetRate:1}),
  row('x1','Outra plataforma',m(90,0,0,0,0),{provider:'kwai'}),
 ];
 const yesterday=[
  row('t5',dd(y)+' - [TESTE] E',m(180,0,0,0,1)),
  row('g1','Campanha boa 1',m(150,300,2,2,3),{dailyBudget:200}),
  row('g2','Campanha boa 2',m(150,400,2,2,3),{dailyBudget:200}),
  row('g3','ESCALA boa 3',m(150,300,2,2,3),{dailyBudget:200}),
  row('s1','Forte manhã',m(150,450,2,2,4),{dailyBudget:200}),
  row('s4','Boa manhã',m(150,170,1,1,4),{dailyBudget:200}),
  row('k1',dd(y)+' - noite pequena',m(90,220,1,1,2),{dailyBudget:100}),
  row('k2',dd(y2)+' - noite grande',m(300,450,2,2,3),{dailyBudget:400}),
  row('k3',dd(y3)+' - noite forte',m(300,900,3,3,4),{dailyBudget:400}),
  row('r1','Aumentada hoje',m(150,330,2,2,3),{dailyBudget:200}),
  row('b1','Real BRL',m(150,330,2,2,3),{dailyBudget:800,budgetCurrency:'BRL',budgetRate:1}),
  row('d1','Sem entrega',m(0,0,0,0,0)),
 ];
 const d3=yesterday.map(r=>({...r,spend:r.spend*3,revenueNet:r.revenueNet*3,revenue:r.revenue*3,frontOrders:r.frontOrders*3,orders:r.orders*3}));
 const k1y=yesterday.find(r=>r.externalId==='k1');d3[d3.findIndex(r=>r.externalId==='k1')]={...k1y};
 const t5y=yesterday.find(r=>r.externalId==='t5');d3[d3.findIndex(r=>r.externalId==='t5')]={...t5y};
 const d7=d3.map(r=>['k1','t5'].includes(r.externalId)?{...r}:{...r,spend:r.spend*2,revenueNet:r.revenueNet*2,revenue:r.revenue*2});
 return {today,yesterday,d3,d7};
}

function stateAt(D,now,{aligned=true,liveFresh=false,liveOnly=false,stale=false,closedEmpty=false}={}){
 const {today,yesterday,d3,d7}=rowsFor(D),from=iso(dayStart(D)),to=iso(dayStart(D)+86400000);
 const cut=(period,fromMs,rows)=>({...base,period,from:iso(fromMs),to:from,fetchedAt:iso(now-600000),lastSyncAt:iso(now-720000),rows:closedEmpty?[]:rows});
 const todayCut={...base,period:'today',from,to,fetchedAt:iso(now-(stale?3600000:300000)),lastSyncAt:iso(now-(stale?3700000:480000)),rows:today};
 const snapshots=[];
 if(liveOnly){
  // After midnight: the previous analysis cut of yesterday plus its closed windows (ending where that cut starts).
  const Y=shift(D,-1),yFrom=dayStart(Y);
  snapshots.push({...base,period:'today',from:iso(yFrom),to:from,fetchedAt:iso(now-3600000),lastSyncAt:iso(now-3600000),rows:yesterday});
  snapshots.push({...base,period:'yesterday',from:iso(yFrom-86400000),to:iso(yFrom),fetchedAt:iso(now-3600000),lastSyncAt:iso(now-3600000),rows:yesterday.filter(r=>r.externalId!=='k1'&&r.externalId!=='t5')});
  snapshots.push({...base,period:'7d',from:iso(yFrom-7*86400000),to:iso(yFrom),fetchedAt:iso(now-3600000),lastSyncAt:iso(now-3600000),rows:d7.map(r=>['t5','k1'].includes(r.externalId)?{...r,spend:0}:r)});
  snapshots.push({...base,period:'3d',from:iso(yFrom-3*86400000),to:iso(yFrom),fetchedAt:iso(now-3600000),lastSyncAt:iso(now-3600000),rows:d3});
 }else{
  snapshots.push(todayCut);
  if(aligned){snapshots.push(cut('7d',dayStart(D)-7*86400000,d7),cut('3d',dayStart(D)-3*86400000,d3),cut('yesterday',dayStart(D)-86400000,yesterday));}
 }
 const liveRows=today.map(r=>r.externalId==='t2'?{...r,spend:205,checkouts:2}:r.externalId==='g2'?{...r,spend:260}:r);
 const live=liveOnly?{projectId:'p',snapshot:{...base,period:'today',from,to,fetchedAt:iso(now-60000),lastSyncAt:iso(now-90000),rows:liveRows}}
  :liveFresh?{projectId:'p',snapshot:{...todayCut,fetchedAt:iso(now-60000),lastSyncAt:iso(now-90000),rows:liveRows}}:null;
 return {state:{config:{p:{projectName:'Fictício'}},snapshots},liveItem:live};
}

/** Deterministic scenario list: [name, evaluateShadow options] over several local times and source shapes. */
export function goldenScenarios(){
 const D='2026-11-07',out=[];
 const times=[['00h10',dayStart(D)+10*60000],['00h40',dayStart(D)+40*60000],['09h30',dayStart(D)+9.5*3600000],['10h30',dayStart(D)+10.5*3600000],['12h30',dayStart(D)+12.5*3600000],['14h00',dayStart(D)+14*3600000],['23h00',dayStart(D)+23*3600000]];
 const shapes=[['aligned',{}],['live',{liveFresh:true}],['not-aligned',{aligned:false}],['stale',{stale:true}],['empty-closed',{closedEmpty:true}]];
 const paramsList=[['none',{}],['policy',{pauseTestMinSpend:200,pauseTestMinSpendNoCheckout:120,ticketFront:300}],['capped',{pauseTestMinSpend:200,pauseTestMinSpendNoCheckout:120,ticketFront:100,budgetCap:300,budgetCaps:{acc1:250}}]];
 const accuracies=[['no-acc',null],['proven',{'bad-day-reduce':{graded:25,right:20,accuracy:0.8,source:'7d'},'night-increase':{graded:25,right:20,accuracy:0.8,source:'7d'},'morning-increase':{graded:25,right:20,accuracy:0.8,source:'7d'}}],['memory',{'bad-day-reduce':{graded:30,right:10,accuracy:0.33,source:'memory'},'morning-increase':{source:'memory-unavailable'}}]];
 for(const [tn,now] of times)for(const [sn,shape] of shapes){
  const {state,liveItem}=stateAt(D,now,shape);
  for(const [pn,params] of paramsList)for(const [an,accuracy] of accuracies){
   if(pn==='none'&&an!=='no-acc')continue;
   const events=an==='proven'?[
    {project:'p',adAccountId:'acc1',objectId:'t3',action:'reduce',actor:'Gestor X',at:iso(now-1800000),origin:'history'},
    {project:'p',adAccountId:'acc1',objectId:'r1',action:'increase',actor:'Gestor Y',at:iso(now-3*3600000),origin:'history'},
    {project:'p',adAccountId:'acc1',objectId:'s1',action:'increase',at:iso(now-4*3600000),origin:'bunker'},
   ]:[];
   out.push([`${tn}|${sn}|${pn}|${an}`,{state,options:{project:'p',liveItem,events,params,now,accuracy}}]);
  }
 }
 // After midnight with only the live cut of the new day (previous analysis cut of yesterday).
 for(const [tn,now] of [['00h10',dayStart(D)+10*60000],['00h25',dayStart(D)+25*60000],['01h30',dayStart(D)+90*60000]]){
  const {state,liveItem}=stateAt(D,now,{liveOnly:true});
  out.push([`${tn}|live-only|policy`,{state,options:{project:'p',liveItem,events:[],params:{ticketFront:300,budgetCap:900},now,accuracy:null}}]);
 }
 // Meta live overlay on a first-day test (display read, first-24h only).
 {const now=dayStart(D)+14*3600000,{state,liveItem}=stateAt(D,now,{});
  const meta={at:iso(now-30000),campaigns:[{id:'t2',adAccountId:'acc1',spend:60,currency:'USD',effectiveStatus:'ACTIVE',startTime:iso(dayStart(D)+3600000)}]};
  out.push(['14h00|meta-live',{state,options:{project:'p',liveItem,events:[],params:{pauseTestMinSpend:200},now,meta}}]);}
 // Unknown project.
 out.push(['unknown-project',{state:{config:{}},options:{project:'p',now:dayStart(D)}}]);
 return out;
}
