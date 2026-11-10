import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {campaignKey} from '../lib/autonomy-grant.mjs';
import {isWarmupCampaign} from '../lib/campaign-scope.mjs';

// The picker helpers live inline in the panel (presentation only); load that block and run it with the same imports.
const src=fs.readFileSync(new URL('../app/autonomy-panel.tsx',import.meta.url),'utf8');
const block=src.slice(src.indexOf('// picker-helpers:start'),src.indexOf('// picker-helpers:end'));
assert.ok(block.length>200,'picker helper block not found in app/autonomy-panel.tsx');
const names=['campaignPickerRows','filterCampaignPicker','groupPickerRows','splitCampaignName','foldText','pickerPageSize','pickerMoney'];
const js=ts.transpileModule(`${block}\nreturn {${names.join(',')}};`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const {campaignPickerRows,filterCampaignPicker,groupPickerRows,splitCampaignName,foldText,pickerPageSize,pickerMoney}=new Function('campaignKey','isWarmupCampaign',js)(campaignKey,isWarmupCampaign);

const row=(o)=>({provider:'Meta',level:'campaign',adAccountId:'act_1',accountName:'Conta Um',status:'ACTIVE',effectiveStatus:'ACTIVE',spend:0,...o});
const rows=[
 row({externalId:'1',name:'07/11 - [CBO] - [JOHN] - [TESTE] - [1-3-1] - JHON_A_457_H1',spend:120.5}),
 row({externalId:'2',name:'07/11 - [CBO] - [JOHN] - [TESTE] - [1-3-1] - JHON_A_458_H1',status:'PAUSED',spend:0}),
 row({externalId:'3',name:'Nova campanha de Engajamento — Cópia'}),
 row({externalId:'4',name:'[ESCALA] Aquisição',adAccountId:'act_2',accountName:'Ávila Ads',spend:30}),
 row({externalId:'5',name:'Kwai campanha',provider:'Kwai'}),
 row({externalId:'1',name:'duplicada'}),
 row({externalId:'6',name:'Sem status',status:undefined,spend:undefined}),
 row({externalId:'7',name:'[TESTE] Antiga',status:'ARCHIVED'}),
 row({externalId:'8',name:'[TESTE] Apagada',status:'DELETED'}),
];

test('Entries keep the saved key and name, Meta only, one per key, warm-up flagged by the policy classifier',()=>{
 const e=campaignPickerRows(rows);
 assert.equal(e.length,7);
 assert.deepEqual(e.map(x=>x.key).sort(),['act_1:1','act_1:2','act_1:3','act_1:6','act_1:7','act_1:8','act_2:4']);
 const first=e.find(x=>x.id==='1');
 assert.equal(first.key,campaignKey('act_1','1'));
 assert.equal(first.name,'07/11 - [CBO] - [JOHN] - [TESTE] - [1-3-1] - JHON_A_457_H1');
 assert.equal(e.find(x=>x.id==='3').warmup,true);
 assert.equal(e.find(x=>x.id==='2').status,'paused');
 assert.equal(e.find(x=>x.id==='6').status,null);
 assert.equal(e.find(x=>x.id==='6').spend,null);
 assert.equal(campaignPickerRows([row({externalId:'9',name:undefined})])[0].name,'9');
 // Grouped by account label (accent-insensitive collation), active first, then paused/no status, then inactive; then spend.
 assert.deepEqual(e.map(x=>x.id),['4','1','3','2','6','7','8']);
});

test('Archived, deleted and other inactive statuses are their own kind, not "paused"',()=>{
 const e=campaignPickerRows(rows);
 assert.equal(e.find(x=>x.id==='7').status,'inactive');assert.equal(e.find(x=>x.id==='7').statusLabel,'Arquivada');
 assert.equal(e.find(x=>x.id==='8').status,'inactive');assert.equal(e.find(x=>x.id==='8').statusLabel,'Excluída');
 assert.equal(campaignPickerRows([row({externalId:'9',status:'WITH_ISSUES'})])[0].statusLabel,'Inativa');
 assert.deepEqual(filterCampaignPicker(e,{paused:true}).rows.map(x=>x.id),['2']);
 assert.deepEqual(filterCampaignPicker(e,{inactive:true}).rows.map(x=>x.id),['7','8']);
});

test('Search is multi-term AND, accent and case insensitive, over name, ID and account',()=>{
 const e=campaignPickerRows(rows);
 assert.deepEqual(filterCampaignPicker(e,{query:'jhon 457'}).rows.map(x=>x.id),['1']);
 assert.deepEqual(filterCampaignPicker(e,{query:'AQUISICAO'}).rows.map(x=>x.id),['4']);
 assert.deepEqual(filterCampaignPicker(e,{query:'avila'}).rows.map(x=>x.id),['4']);
 assert.deepEqual(filterCampaignPicker(e,{query:'  6  '}).rows.map(x=>x.id).includes('6'),true);
 assert.equal(filterCampaignPicker(e,{query:'jhon 999'}).rows.length,0);
 assert.equal(foldText('ÁvIla'),'avila');
});

test('Chips filter status (OR) and spend; counts follow the search; taken and warm-up are hidden',()=>{
 const e=campaignPickerRows(rows);
 const all=filterCampaignPicker(e,{});
 assert.deepEqual(all.counts,{active:2,paused:1,inactive:2,withSpend:2});
 assert.equal(all.outOfScope,1);assert.equal(all.available,6);assert.equal(all.takenSales,0);
 assert.equal(all.rows.some(x=>x.warmup),false);
 assert.deepEqual(filterCampaignPicker(e,{active:true}).rows.map(x=>x.id),['4','1']);
 assert.deepEqual(filterCampaignPicker(e,{active:true,paused:true}).rows.map(x=>x.id),['4','1','2']);
 assert.deepEqual(filterCampaignPicker(e,{withSpend:true}).rows.map(x=>x.id),['4','1']);
 const taken={'act_1:1':{mode:'off',name:'x'}};
 const t=filterCampaignPicker(e,{taken});
 assert.equal(t.rows.some(x=>x.key==='act_1:1'),false);
 assert.equal(t.available,5);assert.equal(t.takenSales,1);
 assert.equal(filterCampaignPicker(e,{taken:new Set(['act_2:4'])}).rows.some(x=>x.key==='act_2:4'),false);
 assert.deepEqual(filterCampaignPicker(e,{query:'jhon'}).counts,{active:1,paused:1,inactive:0,withSpend:1});
 assert.equal(filterCampaignPicker(e,{query:'engajamento'}).outOfScope,1);
});

test('Nothing available: "already exceptions" only when a sales campaign is taken, not for a warm-up-only reading',()=>{
 const warm=campaignPickerRows([row({externalId:'1',name:'Nova campanha de Engajamento'}),row({externalId:'2',name:'[AQUECIMENTO] Perfil'})]);
 assert.ok(warm.every(x=>x.warmup),'fixture must be warm-up only');
 const none=filterCampaignPicker(warm,{taken:{}});
 assert.equal(none.available,0);assert.equal(none.takenSales,0);
 const mixed=campaignPickerRows([row({externalId:'1',name:'Nova campanha de Engajamento'}),row({externalId:'2',name:'[ESCALA] Vendas'})]);
 const allTaken=filterCampaignPicker(mixed,{taken:{'act_1:2':{mode:'off',name:'[ESCALA] Vendas'}}});
 assert.equal(allTaken.available,0);assert.equal(allTaken.takenSales,1);
 // The panel picks the message from these two counts.
 assert.match(src,/!result\.available\?\(result\.takenSales\?[^:]*já são exceções[\s\S]*?Nenhuma campanha de vendas na leitura de hoje/);
});

test('Groups follow the account order and 500+ entries filter quickly',()=>{
 const e=campaignPickerRows(rows);
 const g=groupPickerRows(filterCampaignPicker(e,{}).rows);
 assert.deepEqual(g.map(x=>[x.label,x.rows.length]),[['Ávila Ads',1],['Conta Um',5]]);
 const many=campaignPickerRows(Array.from({length:800},(_,i)=>row({externalId:String(i),adAccountId:`act_${i%4}`,accountName:`Conta ${i%4}`,name:`07/11 - [CBO] - [JOHN] - [TESTE] - JHON_A_${i}_H1`,status:i%3?'ACTIVE':'PAUSED',spend:i%5})));
 const t0=performance.now();
 for(let k=0;k<20;k++)filterCampaignPicker(many,{query:'jhon 7',active:true});
 assert.ok(performance.now()-t0<500);
 assert.ok(filterCampaignPicker(many,{}).rows.length>pickerPageSize);
});

test('Long names split into a muted shared head and the distinctive tail',()=>{
 assert.deepEqual(splitCampaignName('07/11 - [CBO] - [JOHN] - [TESTE] - [1-3-1] - JHON_A_457_H1'),{head:'07/11 - [CBO] - [JOHN] - [TESTE] - [1-3-1] - ',tail:'JHON_A_457_H1'});
 assert.deepEqual(splitCampaignName('[TESTE] - JHON_A_1 - Cópia'),{head:'[TESTE] - ',tail:'JHON_A_1 - Cópia'});
 assert.deepEqual(splitCampaignName('Nova campanha de Engajamento — Cópia'),{head:'',tail:'Nova campanha de Engajamento — Cópia'});
 assert.deepEqual(splitCampaignName('[TESTE] Aquisição'),{head:'',tail:'[TESTE] Aquisição'});
 assert.deepEqual(splitCampaignName(''),{head:'',tail:''});
});

test('Spend uses the reading currency; without a valid code it is a bare number, never an invented R$',()=>{
 const n=1234.5;
 assert.equal(pickerMoney(n,'BRL'),n.toLocaleString('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:2}));
 assert.equal(pickerMoney(n,'USD'),n.toLocaleString('pt-BR',{style:'currency',currency:'USD',maximumFractionDigits:2}));
 assert.doesNotMatch(pickerMoney(n,'USD'),/R\$/);
 assert.doesNotMatch(pickerMoney(n,null),/R\$|US\$|\$/);
 assert.doesNotMatch(pickerMoney(n,'reais'),/R\$/);
 assert.doesNotMatch(src,/currency:'BRL'/);
});

test('Adding still saves {mode:"off",name} under the same key through edit(); nothing is added on its own',()=>{
 assert.match(src,/const addCampaigns=useCallback\(\(list:any\[\]\)=>\{for\(const r of list\)edit\(x=>\{x\.campaigns\[r\.key\]=\{mode:'off',name:r\.name\};return x;\}\);/);
 assert.equal((src.match(/x\.campaigns\[[^\]]+\]=\{/g)||[]).length,1);
 assert.ok(!fs.existsSync(new URL('../lib/autonomy-campaign-picker.mjs',import.meta.url)));
});
