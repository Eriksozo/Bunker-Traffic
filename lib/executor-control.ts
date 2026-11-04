import {env} from 'cloudflare:workers';
import {storage} from './storage';
export async function executorControl(input:{action:string}){
 const namespace=(env as any).BUNKER_EXECUTOR;
 if(namespace){const r=await namespace.getByName('primary').fetch('https://bunker-internal/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});const data=await r.json();if(!r.ok)throw Error(data.error||'Executor indisponível.');return data;}
 const db=storage() as any;return db.rpc('cloudExecutor',input);
}
