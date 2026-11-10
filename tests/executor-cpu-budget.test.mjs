import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Owner report of 10/11/2026 ("bunk não conseguiu ler nada"): the executor object was reset several times an hour for
// exceeding its CPU limit, and the notch read 503s. Between pulses the Sombra stays on every reading; the long memory not.
const src=fs.readFileSync(new URL('../worker/cloud-executor.ts',import.meta.url),'utf8');
const vite=fs.readFileSync(new URL('../vite.config.ts',import.meta.url),'utf8');

test('Between-pulse shadow runs skip the long memory unless it is older than the interval; the heavy pulse always learns',()=>{
 assert.match(src,/this\.queueShadow\(state,\{learn:false\}\)/,'freshShadow asks for a light run');
 assert.match(src,/await this\.queueShadow\(liveState\)\.catch/,'heavy pulse: full run');
 const body=src.slice(src.indexOf(' private async storeShadow(state:any,opts'),src.indexOf(' private async ownerNames('));
 const guard=body.indexOf('if(opts.learn===false&&now-this.lastLearnAt<BunkerCloudExecutor.betweenPulseLearnMs)return merged;');
 assert.ok(guard>0,'guard present');
 assert.ok(guard>body.indexOf("put('shadowStatus'")&&guard>body.indexOf('this.autonomyAct('),'decisions, status and autonomy still run every reading');
 assert.ok(guard<body.indexOf('this.storeLearning('),'only the memory is skipped');
 assert.match(src,/betweenPulseLearnMs=5\*60000/);
});

test('The Cloudflare build declares the Standard plan CPU ceiling',()=>{
 assert.match(vite,/limits:\{cpu_ms:300000\}/);
});
