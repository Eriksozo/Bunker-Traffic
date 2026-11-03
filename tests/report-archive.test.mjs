import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {archiveApprovedReportsSql,reportsQuery,reportPage,reportCursor,parseReportCursor,safeReportFilename} from '../lib/report-archive.mjs';
const report=(id,project='john',createdAt='2026-11-02T12:00:00.000Z')=>({id,project,createdAt,title:'Saved '+id,text:'Actual report '+id});
function db(){const d=new DatabaseSync(':memory:');for(const migration of ['0000_flashy_madame_web.sql','0001_medical_typhoid_mary.sql'])d.exec(readFileSync(new URL('../drizzle/'+migration,import.meta.url),'utf8').replaceAll('--> statement-breakpoint',''));return d;}
function central(d,reports,revision=1){d.prepare('INSERT OR REPLACE INTO bunker_records VALUES (?,?,?,?)').run('central',JSON.stringify({reports}),revision,'2026-11-02T12:00:00Z');}
function page(d,project,limit=20,cursor=null){const q=reportsQuery(project,limit,cursor);return reportPage(d.prepare(q.sql).all(...q.params),limit);}
test('Legacy reports are readable before the first archival commit and duplicate IDs stay single',()=>{const d=db(),r=report('legacy');central(d,[r]);assert.deepEqual(page(d,'john').items,[r]);d.exec(archiveApprovedReportsSql);assert.deepEqual(page(d,'john').items,[r]);d.close();});
test('More than30 reports survive central rolling buffer; cursor tie-breaks are stable and client-scoped',()=>{
 const d=db();let reports=[];for(let i=0;i<75;i++){reports=[report(String(i).padStart(3,'0'),i%2?'nico':'john'),...reports].slice(0,30);central(d,reports,i+1);d.exec(archiveApprovedReportsSql);}
 assert.equal(d.prepare('SELECT COUNT(*) AS n FROM bunker_reports').get().n,75);
 let cursor=null,ids=[];do{const p=page(d,'john',7,cursor);ids.push(...p.items.map(r=>r.id));assert.ok(p.items.every(r=>r.project==='john'));cursor=p.nextCursor;}while(cursor);
 assert.equal(ids.length,38);assert.equal(new Set(ids).size,38);assert.deepEqual(ids,[...ids].sort().reverse());d.close();
});
test('A failed optimistic update can archive only the approved central row, never rejected candidate payload',()=>{
 const d=db(),approved=report('approved'),rejected=report('rejected');central(d,[approved],4);d.exec('BEGIN');
 const result=d.prepare('UPDATE bunker_records SET payload=?,revision=5 WHERE key=? AND revision=?').run(JSON.stringify({reports:[rejected]}),'central',3);
 d.exec(archiveApprovedReportsSql);d.exec('COMMIT');assert.equal(result.changes,0);assert.deepEqual(page(d,'john').items,[approved]);assert.equal(d.prepare('SELECT COUNT(*) AS n FROM bunker_reports WHERE id=?').get('rejected').n,0);d.close();
});
test('Archive failure rolls back the central revision in the transaction used for the batch',()=>{
 const d=db();central(d,[report('first')],1);d.exec('DROP TABLE bunker_reports');d.exec('BEGIN');
 d.prepare('UPDATE bunker_records SET revision=2 WHERE key=? AND revision=?').run('central',1);assert.throws(()=>d.exec(archiveApprovedReportsSql),/no such table/);d.exec('ROLLBACK');
 assert.equal(d.prepare('SELECT revision FROM bunker_records').get().revision,1);d.close();
});
test('Cursor and export names reject unsafe or malformed input without interpolating query data',()=>{
 const r=report('id-01');assert.deepEqual(parseReportCursor(reportCursor(r)),{createdAt:r.createdAt,id:r.id});assert.throws(()=>parseReportCursor('bad!'));assert.throws(()=>reportsQuery('john',100));
 const q=reportsQuery("john' OR 1=1 --",10);assert.ok(!q.sql.includes("john'"));assert.equal(q.params[0],"john' OR 1=1 --");assert.equal(safeReportFilename('../bad/name\u0000.txt'),'.. bad name .txt.txt');
});

test('Archive keeps immutable report text and includes shared reports without leaking another client',()=>{const d=db();const first=report('saved');central(d,[first]);d.exec(archiveApprovedReportsSql);central(d,[{...first,text:'later changed buffer'},report('shared','all'),report('private-nico','nico')]);const p=page(d,'john');assert.equal(p.items.find(r=>r.id==='saved').text,first.text);assert.ok(p.items.some(r=>r.id==='shared'));assert.ok(!p.items.some(r=>r.id==='private-nico'));d.close();});
