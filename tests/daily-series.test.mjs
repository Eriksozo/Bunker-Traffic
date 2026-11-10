import test from 'node:test';
import assert from 'node:assert/strict';
import {dailySeriesArgs,projectDays,daysSummary,dailySeriesPolicy} from '../lib/daily-series.mjs';
import {cloudReadTools,cloudWriteTools} from '../lib/cloud-malva.mjs';

// Malva answer for Gabe (2026-11-10), with ad fees: ROI = (profit + spend + fees) / (spend + fees).
const gabe={currency:'BRL',period:{timezone:'America/Sao_Paulo'},points:[
 {key:'2026-11-04',spend:0,orders:0,revenueNet:0,profit:0,adCosts:0,roi:null},
 {key:'2026-11-09',spend:1163.12,orders:5,revenueNet:1284.99,profit:-52.24,adCosts:174.11,roi:0.9609},
 {key:'2026-11-10',spend:2551.07,orders:4,revenueNet:1071.24,profit:-1713.29,adCosts:233.46,roi:0.3847}]};
const john={currency:'BRL',period:{timezone:'America/Sao_Paulo'},points:[
 {key:'2026-11-04',spend:100,orders:2,revenueNet:300,profit:150,adCosts:10,roi:2.3636},
 {key:'2026-11-09',spend:1000,orders:10,revenueNet:2000,profit:800,adCosts:50,roi:1.7619},
 {key:'2026-11-10',spend:500,orders:null,revenueNet:900,profit:200,adCosts:25,roi:1.381}]};
const config={g:{projectName:'Gabe'},j:{projectName:'John'}};
const now=Date.parse('2026-11-10T15:00:00Z'),at=new Date(now-60000).toISOString();
const stored=(projects)=>({checkedAt:at,projects});

test('one read per project: 7 days with today, Meta, traffic sales, six metrics', () => {
 const args=dailySeriesArgs('g');
 assert.deepEqual(args,{projectId:'g',metrics:['spend','orders','revenueNet','profit','adCosts','roi'],preset:'7d',granularity:'day',provider:['meta'],sales:'traffic'});
 assert.ok(args.metrics.length<=6);
 assert.ok(cloudReadTools.includes('tracking_series')&&!cloudWriteTools.includes('tracking_series'));
});

test('a single project keeps Malva ROI and derives CPA and ROAS; newest first, today marked', () => {
 const d=daysSummary(stored({g:{...projectDays(gabe),at,error:null}}),{project:'g',config,now});
 assert.equal(d.error,null);assert.equal(d.today,'2026-11-10');assert.equal(d.currency,'BRL');
 assert.deepEqual(d.rows.map(r=>r.day),['2026-11-10','2026-11-09','2026-11-04']);
 const nov9=d.rows[1];
 assert.equal(nov9.cpa,232.62);assert.equal(nov9.roas,1.1048);assert.equal(nov9.roi,0.9609);
 assert.equal(d.rows[2].cpa,null);assert.equal(d.rows[2].roas,null);assert.equal(d.rows[2].roi,null); // no spend → N/D, never zero
});

test('our ROI formula matches Malva on a single project', () => {
 const p=projectDays(gabe);
 for(const day of p.days.filter(x=>x.spend>0)){const cost=day.spend+day.adCosts;assert.ok(Math.abs((day.profit+cost)/cost-day.roi)<0.0001,day.day);}
});

test('all projects: sums day by day and rebuilds the ratios from the sums', () => {
 const d=daysSummary(stored({g:{...projectDays(gabe),at,error:null},j:{...projectDays(john),at,error:null}}),{project:'all',config,now});
 const nov9=d.rows.find(r=>r.day==='2026-11-09');
 assert.equal(nov9.spend,2163.12);assert.equal(nov9.orders,15);assert.equal(nov9.revenueNet,3284.99);assert.equal(nov9.profit,747.76);
 assert.equal(nov9.cpa,144.21);assert.equal(nov9.roas,1.5186);
 assert.equal(nov9.roi,Math.round((747.76+2163.12+224.11)/(2163.12+224.11)*10000)/10000);
 const today=d.rows[0];assert.equal(today.orders,null);assert.equal(today.cpa,null); // one missing count leaves the sum N/D
 assert.equal(today.spend,3051.07);
});

test('a project never read leaves "all" unavailable instead of a smaller total', () => {
 const d=daysSummary(stored({g:{...projectDays(gabe),at,error:null}}),{project:'all',config,now});
 assert.deepEqual(d.rows,[]);assert.deepEqual(d.missing,['John']);assert.match(d.error,/John/);
});

test('a failed refresh keeps the previous days and marks the block stale', () => {
 const d=daysSummary(stored({g:{...projectDays(gabe),at,error:'MCP_TIMEOUT'},j:{...projectDays(john),at,error:null}}),{project:'all',config,now});
 assert.equal(d.rows.length,3);assert.equal(d.stale,true);assert.deepEqual(d.failing,['Gabe']);
 const old=daysSummary(stored({g:{...projectDays(gabe),at:new Date(now-dailySeriesPolicy.staleMs-1).toISOString(),error:null}}),{project:'g',config,now});
 assert.equal(old.stale,true);
});

test('different currencies never add money', () => {
 const d=daysSummary(stored({g:{...projectDays(gabe),at,error:null},j:{...projectDays({...john,currency:'USD'}),at,error:null}}),{project:'all',config,now});
 assert.equal(d.currency,null);assert.ok(d.rows.every(r=>r.spend===null&&r.profit===null&&r.roi===null));
 assert.equal(d.rows.find(r=>r.day==='2026-11-09').orders,15);
});

test('days after today (another timezone) are not shown and junk points are dropped', () => {
 const p=projectDays({currency:'brl',points:[{key:'2026-11-11',spend:1},{key:'bad',spend:2},{key:'2026-11-10',spend:'3'}]});
 assert.equal(p.currency,null);assert.deepEqual(p.days.map(d=>d.day),['2026-11-11','2026-11-10']);assert.equal(p.days[1].spend,null);
 const d=daysSummary(stored({g:{...p,at,error:null}}),{project:'g',config,now});
 assert.deepEqual(d.rows.map(r=>r.day),['2026-11-10']);
});
