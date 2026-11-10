import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Owner decision of 09/11/2026 ("Yes, keep 24h"): superseded `snapshots:` copies are deleted in the commit transaction.
const dir=new URL('../supabase/migrations/',import.meta.url);
const latest=fs.readdirSync(dir).filter(f=>f.endsWith('.sql')&&fs.readFileSync(new URL(f,dir),'utf8').includes('FUNCTION public.bunker_store')).sort().at(-1);
const sql=fs.readFileSync(new URL(latest,dir),'utf8');

test('The live bunker_store deletes only old snapshot copies the new central does not point to',()=>{
 const del=sql.slice(sql.indexOf('delete from public.bunker_records'));
 assert.ok(sql.indexOf('delete from public.bunker_records')>sql.indexOf("if operation='commit' and affected=1 then"),'only after the central compare-and-swap won');
 assert.ok(sql.indexOf('delete from public.bunker_records')<sql.indexOf("elsif operation='get'"),'inside the commit branch');
 assert.equal((sql.match(/delete from public\.bunker_records/g)||[]).length,1,'the only delete');
 assert.match(del,/where key like 'snapshots:%'/);
 assert.match(del,/key is distinct from \(\(input->>'payload'\)::jsonb->'snapshotStorage'->>'key'\)/,'never the copy the central points to');
 assert.match(del,/interval '24 hours'/);
});
