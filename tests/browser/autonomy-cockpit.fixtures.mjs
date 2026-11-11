/* Read-only AutonomyDeepView fixtures for the web cockpit (W2), shaped per docs/AUTONOMIA-V2-CONTRATO-2026-11-10.md (a).
 * Fake projects, campaigns and numbers only: nothing operational. Three states: empty (executor has a base but no memory),
 * partial (learningSummary present, pb:view missing), full (everything, including playbook plays and a divergence). */
export const fixtureNow=Date.parse('2026-11-10T15:00:00Z');
const at=(min)=>new Date(fixtureNow-min*60000).toISOString();
const win=(spend,front,roi)=>({spend,frontOrders:front,orders:front,revenueNet:spend===null||roi===null?null:Math.round(spend*(roi+1)*100)/100,result:null,roi,roas:null,cpc:null,ic:null});
const levelOf=(mode,extra={})=>({mode,actions:{pause:true,reduce:true,increase:false,activate:false},limits:{maxIncreasePct:null,maxReducePct:30,budgetCap:1000,ordersPerDay:2},exceptions:0,configured:true,shadowPolicy:true,...extra});
const zeroScore=(rev='rules@2')=>({rev,label:null,graded:0,right:0,accuracy:null,low:null,high:null,base:null,chanceBetter:null,trend:{recent:{graded:0,accuracy:null},previous:{graded:0,accuracy:null}},winnersCut:0,stage:'sombra',gate:null});
const fixedRules=['test-no-sale','young-loss','mature-loss','bad-day-reduce','night-increase','morning-increase'];
const caps={campaigns:80,decisions:150,done:50,plays:12,caseRefs:5,blindSpots:20,divergences:10,proposals:5,people:8};

const campaign=(o)=>({key:`${o.adAccountId||'act_1'}:${o.objectId}`,adAccountId:'act_1',accountName:'Conta Um',name:null,stage:'mature',test:false,mode:'shadow',budget:{dailyBudget:600,currency:'BRL'},
 windows:{today:win(320,2,0.4),yesterday:win(580,6,1.2),d3:win(1500,14,1.1),d7:win(3600,30,0.9)},partialDay:null,
 guard:{ordersToday:0,ordersLimit:2,cooldownMin:0,budget:600,capUse:{cur:600,cap:1000,currency:'BRL',share:0.6,mixedCurrency:false},contingency:[]},...o});

const decision=(o)=>({id:JSON.stringify(['2026-11-10',o.rule||'bad-day-reduce','p-alfa','act_1',o.objectId||'111','budget']),source:'rules',rule:'bad-day-reduce',ruleLabel:'Dia ruim: reduzir',rev:'rules@2',
 project:'p-alfa',projectName:'Projeto Alfa',adAccountId:'act_1',accountName:'Conta Um',objectId:'111',campaign:'07/11 - [CBO] - [ALFA] - [ESCALA] - ALFA_A_12_H1',action:'budget',kind:'reduce',
 before:{dailyBudget:600,currency:'BRL'},after:{dailyBudget:420,currency:'BRL'},percent:-30,reason:'ROI de hoje 0,40x depois das 13h com gasto acima de 3 tickets.',
 metrics:{spend:320,frontOrders:2,orders:2,revenueNet:448,checkouts:9,roi:0.4,roas:1.4,cpc:4.1,recentRoi:1.1},limitations:[],blockedBy:[],status:'so-sugestao',suggestionWhy:'placar',holdReasons:[],
 mode:'shadow',wouldExecute:false,wouldFire:true,current:true,gate:{graded:12,right:7,need:20,min:0.6,metric:'accuracy',proven:false,source:'7d'},sameAsRule:null,manager:null,owner:null,
 grade:{d1:null,d3:null,pauseProxy:null,opposite:null},firstAt:at(40),lastAt:at(1),firstWouldExecuteAt:null,proposalId:null,play:null,...o});

const ruleScores=(over={})=>Object.fromEntries(fixedRules.map(r=>[r,{...zeroScore(),stage:['bad-day-reduce','night-increase','morning-increase'].includes(r)?'sombra':'pode-enviar',...(over[r]||{})}]));

const baseTop=(o)=>({v:1,at:at(0),baseAt:at(1),stateAt:at(2),project:'all',enabled:false,paused:false,
 status:{at:at(1),ok:true,enabled:false,acting:false,created:0,logged:0},
 shadowStatus:{at:at(1),failed:false,version:2,days:{'p-alfa':'2026-11-10','p-beta':'2026-11-10'},skipped:[],evaluated:40,ms:120},
 learningStatus:null,playbookStatus:null,memory:null,
 totals:{decisions:{enviaria:0,pediria:0,'so-sugestao':0,segurada:0,desligado:0},orders:{created:0,sent:0,confirmed:0,failed:0},agreement:null},
 projects:{},caps,truncated:{},...o});

const projectBase=(o)=>({name:'Projeto Alfa',timezone:'America/Sao_Paulo',day:'2026-11-10',level:levelOf('shadow'),pilot:null,now:{campaigns:[]},decisions:[],done:[],
 score:{rules:ruleScores(),plays:{},lead14d:null,blindSpots:[]},team:null,playbook:null,...o});

/** Executor answered, but there is no learning memory, no playbook and no decision yet. */
export const deepEmpty=baseTop({projects:{'p-alfa':projectBase({}),'p-beta':projectBase({name:'Projeto Beta',level:levelOf('off',{shadowPolicy:false})})}});

/** learningSummary present (score, team), pb:view still missing (people figures N/D, playbook null). */
export const deepPartial=baseTop({
 learningStatus:{at:at(5),ok:true,summarized:true},
 memory:{days:31,from:'2026-10-10',peopleMoves:[],excluded:{total:0,byReason:{}},quarantined:0,backfill:{}},
 shadowStatus:{at:at(1),failed:false,version:2,days:{'p-alfa':'2026-11-10'},skipped:[{project:'p-beta',projectName:'Projeto Beta',reason:'fonte com 42 min'}],evaluated:40,ms:120},
 totals:{decisions:{enviaria:0,pediria:0,'so-sugestao':2,segurada:1,desligado:0},orders:{created:0,sent:0,confirmed:0,failed:0},agreement:null},
 projects:{'p-alfa':projectBase({
  now:{campaigns:[campaign({objectId:'111',name:'07/11 - [CBO] - [ALFA] - [ESCALA] - ALFA_A_12_H1'}),campaign({objectId:'112',name:'08/11 - [CBO] - [ALFA] - [TESTE] - ALFA_A_13_H1',stage:'first-day',test:true,budget:{dailyBudget:150,currency:'BRL'},windows:{today:win(90,0,null),yesterday:null,d3:null,d7:null},guard:{ordersToday:0,ordersLimit:2,cooldownMin:0,budget:150,capUse:{cur:150,cap:1000,currency:'BRL',share:0.15,mixedCurrency:false},contingency:[]}})]},
  decisions:[decision({}),decision({objectId:'112',rule:'test-no-sale',ruleLabel:'Teste sem venda: pausar',campaign:'08/11 - [CBO] - [ALFA] - [TESTE] - ALFA_A_13_H1',action:'status',kind:'pause',before:{status:'ACTIVE'},after:{status:'PAUSED'},percent:null,reason:'Gasto de R$ 90 sem venda no 1º dia.',status:'segurada',suggestionWhy:null,holdReasons:['Edição de outra pessoa há menos de 2h.'],blockedBy:['Edição de outra pessoa há menos de 2h.'],gate:null,wouldFire:false,manager:{actor:'Jorge',at:at(20),minutesAfter:15,before:null,after:null}}),
   decision({objectId:'113',rule:'night-increase',ruleLabel:'Noite boa: aumentar',kind:'increase',before:{dailyBudget:300,currency:'BRL'},after:{dailyBudget:390,currency:'BRL'},percent:30,status:'so-sugestao',suggestionWhy:'nivel-sombra',gate:null,campaign:'05/11 - [CBO] - [ALFA] - ALFA_B_2'})],
  score:{rules:ruleScores({'bad-day-reduce':{graded:12,right:7,accuracy:7/12,low:0.32,high:0.81,stage:'sombra',gate:{graded:12,right:7,need:20,min:0.6,proven:false,source:'7d'}},'test-no-sale':{graded:9,right:8,accuracy:8/9,low:0.57,high:0.98,base:{expected:0.5,accuracy:0.89,edge:0.39,graded:9},trend:{recent:{graded:5,accuracy:0.8},previous:{graded:4,accuracy:1}},winnersCut:0,stage:'pode-enviar'}}),plays:{},
   lead14d:{cuts:6,ahead:4,share:0.667,medianLeadMin:35,previous:{cuts:5,ahead:2,share:0.4},daily:[{day:'2026-11-08',cuts:2,ahead:1},{day:'2026-11-09',cuts:3,ahead:2},{day:'2026-11-10',cuts:1,ahead:1}]},
   blindSpots:[{day:'2026-11-09',kind:'reduce',by:'manager',at:at(1300),adAccountId:'act_1',objectId:'111'}]},
  team:{people:[{person:'owner',name:'Você',role:'owner',counts:{actions:20,pause:9,reduce:6,increase:5,activate:0},testPauses:{n:6,campaigns:6,median:95,p25:70,p75:130,beforePoint:4},budget:{graded:8,right:6,accuracy:0.75,low:0.41,high:0.93,medianUp:0.3,medianDown:-0.2},hours:null,agreement:null}],proposals:[]},
 })}});

const play=(o)=>({id:'pb:test-pause',key:'pb:test-pause@p-alfa',rev:'v3:ab12cd34',version:3,role:'challenger',stage:'candidata',sentence:'Pausa teste de 1º ou 2º dia sem venda quando o gasto passa de 2 tickets.',
 params:{k:2,stage:1},step:null,learnedFrom:[{person:'p:j1',name:'Jorge',n:14,params:{k:1.8}},{person:'owner',name:'Você',n:9,params:{k:2.4}},{person:'p:l1',name:'Leonardo Paz',n:3,params:null}],
 support:{moves:26,campaigns:19,days:12,need:{moves:8,campaigns:4,days:3},missing:0},agreement:{precision:0.74,recall:0.61,leadMin:28,opposite:0.04,low:0.58,high:0.86,n:23},
 outcome:{d1:{rate:0.7,n:20,low:0.48,high:0.85},d3:null,base:0.55},wouldHave7d:{total:9,sameAsTeam:7,nobodyDid:2},flags:['horario-expediente'],
 challenger:{rev:'v4:ee77ff00',diff:[{param:'k',from:2,to:1.8}]},caseRefs:[{day:'2026-11-09',adAccountId:'act_1',objectId:'112',campaign:'08/11 - [CBO] - [ALFA] - [TESTE] - ALFA_A_13_H1',person:'p:j1',name:'Jorge',kind:'pause',at:at(1500),step:null}],
 adoptable:false,adoptHint:'chega na próxima fase',...o});

/** Everything present: playbook plays (one candidate, one observing, one "imitação sem ganho"), people, divergence, orders done. */
export const deepFull=baseTop({
 enabled:true,
 learningStatus:{at:at(5),ok:true,summarized:true},
 playbookStatus:{v:1,at:at(3),ok:true,stage:'learning',ms:900,partial:false,last:{shadow:{at:at(1),ok:true},learning:{at:at(3),ok:true},backfill:{at:at(60),ok:true,calls:2}}},
 memory:{days:31,from:'2026-10-10',peopleMoves:[{person:'p:j1',name:'Jorge',role:'team',moves:240},{person:'owner',name:'Você',role:'owner',moves:180},{person:'p:l1',name:'Leonardo Paz',role:'team',moves:92},{person:'outside',name:'Fora da Malva Dash',role:'outside',moves:4}],
  excluded:{total:3,byReason:{bunk:2,automation:1}},quarantined:1,backfill:{'p-alfa':{complete:true,from:'2026-10-10',to:'2026-11-09',moves:310,at:at(600)}}},
 totals:{decisions:{enviaria:1,pediria:1,'so-sugestao':2,segurada:1,desligado:1},orders:{created:1,sent:1,confirmed:1,failed:0},agreement:{precision:0.74,recall:0.61,leadMin:28,opposite:0.04,low:0.58,high:0.86,n:23}},
 projects:{
  'p-alfa':projectBase({level:levelOf('auto',{exceptions:1}),
   now:{campaigns:[campaign({objectId:'111',mode:'auto',name:'07/11 - [CBO] - [ALFA] - [ESCALA] - ALFA_A_12_H1',guard:{ordersToday:1,ordersLimit:2,cooldownMin:35,budget:600,capUse:{cur:600,cap:1000,currency:'BRL',share:0.6,mixedCurrency:true},contingency:['Sem teto diário de perda salvo.']}}),campaign({objectId:'114',mode:'off',name:'[ESCALA] Alfa USD',budget:{dailyBudget:200,currency:'USD'}})]},
   decisions:[decision({status:'enviaria',suggestionWhy:null,mode:'auto',wouldExecute:true,firstWouldExecuteAt:at(30),proposalId:'prop-1'}),
    decision({objectId:'115',status:'pediria',suggestionWhy:null,mode:'confirm',wouldExecute:true,firstWouldExecuteAt:at(10),campaign:'[ESCALA] Alfa Confirmar'}),
    decision({objectId:'112',id:JSON.stringify(['2026-11-10','pb:test-pause','p-alfa','act_1','112','status']),source:'playbook',rule:'pb:test-pause',ruleLabel:'Pausa teste de 1º ou 2º dia sem venda quando o gasto passa de 2 tickets.',rev:'v3:ab12cd34',action:'status',kind:'pause',before:{status:'ACTIVE'},after:{status:'PAUSED'},percent:null,
     status:'so-sugestao',suggestionWhy:'jogada-em-observacao',gate:{graded:4,right:3,need:15,min:0.5,metric:'low',proven:false,source:'pbs'},wouldExecute:false,sameAsRule:'test-no-sale',
     play:{key:'pb:test-pause@p-alfa',params:{k:2},learnedStep:null,clampedStep:null,learnedFrom:[{person:'p:j1',name:'Jorge',n:14},{person:'owner',name:'Você',n:9}],caseRefs:[]},campaign:'08/11 - [CBO] - [ALFA] - [TESTE] - ALFA_A_13_H1'}),
    decision({objectId:'114',status:'desligado',suggestionWhy:null,mode:'off',campaign:'[ESCALA] Alfa USD',before:{dailyBudget:200,currency:'USD'},after:{dailyBudget:140,currency:'USD'}})],
   done:[{proposalId:'prop-1',project:'p-alfa',adAccountId:'act_1',objectId:'111',campaign:'07/11 - [CBO] - [ALFA] - [ESCALA] - ALFA_A_12_H1',rule:'bad-day-reduce',shadowId:null,at:at(30),action:'budget',kind:'reduce',percent:-30,
    before:{dailyBudget:600,currency:'BRL'},after:{dailyBudget:420,currency:'BRL'},executionStatus:'Confirmada',steps:[{kind:'decidiu',at:at(30)},{kind:'enviada',at:at(29)},{kind:'confirmada',at:at(28)}],
    monitorChecks:[{minutes:15,at:at(13),status:'ok',delta:{spend:12,roi:0.1,result:null}}],grade:null}],
   score:{rules:ruleScores({'bad-day-reduce':{graded:22,right:15,accuracy:0.68,low:0.47,high:0.84,base:{expected:0.5,accuracy:0.68,edge:0.18,graded:22},chanceBetter:0.91,trend:{recent:{graded:10,accuracy:0.7},previous:{graded:12,accuracy:0.67}},winnersCut:1,stage:'pode-enviar',gate:{graded:22,right:15,need:20,min:0.6,proven:true,source:'7d'}}}),
    plays:{'pb:test-pause@p-alfa':{...zeroScore('v3:ab12cd34'),label:'Pausa teste sem venda',graded:4,right:3,accuracy:0.75,low:0.3,high:0.95,stage:'candidata'}},lead14d:null,blindSpots:[]},
   team:{people:[{person:'p:j1',name:'Jorge',role:'team',counts:{actions:60,pause:30,reduce:15,increase:15,activate:0},testPauses:{n:14,campaigns:12,median:80,p25:60,p75:110,beforePoint:9},budget:{graded:20,right:14,accuracy:0.7,low:0.48,high:0.85,medianUp:0.5,medianDown:-0.25},hours:Array.from({length:24},(_,h)=>h>=9&&h<=20?(h%5)+1:0),agreement:{precision:0.8,recall:0.6,leadMin:30,opposite:0.05,low:0.6,high:0.9,n:16}},
    {person:'owner',name:'Você',role:'owner',counts:{actions:20,pause:9,reduce:6,increase:5,activate:0},testPauses:{n:6,campaigns:6,median:95,p25:70,p75:130,beforePoint:4},budget:{graded:8,right:6,accuracy:0.75,low:0.41,high:0.93,medianUp:0.2,medianDown:-0.15},hours:null,agreement:{precision:null,recall:null,leadMin:null,opposite:null,low:null,high:null,n:0}}],
    proposals:[{id:'tp1',kind:'test-pause',n:8,campaigns:7,days:6,median:85,p25:70,p75:110,current:120,value:85,text:'Projeto Alfa: em 30 dias, vocês fizeram 8 pausas de campanhas novas sem venda.'}]},
   playbook:{fitAt:at(180),nextFitAt:at(-180),state:'com-candidatas',plays:[play({}),
    play({id:'pb:morning-batch-raise',key:'pb:morning-batch-raise@p-alfa',rev:'v1:11aa22bb',version:1,stage:'observando',sentence:'Aumenta de manhã quando o ROI de hoje já passou de 1,5x.',step:{median:0.3,p25:0.2,p75:0.5},
     support:{moves:5,campaigns:3,days:2,need:{moves:8,campaigns:4,days:3},missing:3},agreement:{precision:null,recall:null,leadMin:null,opposite:null,low:null,high:null,n:0},outcome:{d1:null,d3:null,base:null},wouldHave7d:null,flags:[],challenger:null,caseRefs:[]}),
    play({id:'pb:bad-day-cut',key:'pb:bad-day-cut@p-alfa',rev:'v2:33cc44dd',version:2,stage:'candidata',sentence:'Corta 20% quando o dia está ruim depois das 16h.',step:{median:-0.2,p25:-0.3,p75:-0.15},flags:['imitacao-sem-ganho','cortes-em-vencedoras'],challenger:null})],
    divergences:[{id:'dv1',playId:'pb:bad-day-cut',cell:{stage:'mature',hourSlot:'16-20',roiBucket:'0.8-1'},people:[{person:'p:j1',name:'Jorge',kind:'reduce',n:4},{person:'owner',name:'Você',kind:'increase',n:3}],text:'Jorge corta e você aumenta na mesma situação (madura, 16h–20h, ROI 0,8–1x).'}]}}),
  'p-beta':projectBase({name:'Projeto Beta',level:levelOf('off'),decisions:[],now:{campaigns:[]}}),
 }});

/** view=sim rows for p-alfa (positional, per the contract columns). */
export const simAlfa={v:1,at:at(0),project:'p-alfa',timezone:'America/Sao_Paulo',today:'2026-11-10',
 columns:['id','day','rule','adAccountId','objectId','campaign','action','beforeBudget','afterBudget','currency','afterStatus','wouldExecute','alertOnly','firstWouldExecuteAt','verdict','winnerCut'],
 rows:[['s1','2026-11-10','bad-day-reduce','act_1','111','ALFA_A_12_H1','budget',600,420,'BRL',null,true,false,at(30),null,false],
  ['s2','2026-11-09','test-no-sale','act_1','112','ALFA_A_13_H1','status',null,null,null,'PAUSED',true,false,at(1400),'acertou',false]],
 seedOrders:[],saved:null,truncated:0};
