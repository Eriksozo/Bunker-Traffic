import {homedir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';

// Only a data relay: this service never starts analysis or executes ad actions.
const label='com.eriksozo.bunker-live-sync';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const plist=resolve(homedir(),'Library/LaunchAgents',label+'.plist');
const logs=resolve(homedir(),'Library/Logs/Bunker');
const domain=`gui/${process.getuid()}`,target=domain+'/'+label;
const escape=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const run=args=>spawnSync('/bin/launchctl',args,{encoding:'utf8'});
const mode=process.argv[2]||'status';

if(mode==='status'){
 const result=run(['print',target]);
 console.log(JSON.stringify({label,installed:result.status===0,summary:result.status===0?result.stdout.split('\n').filter(line=>/^\s*(state|pid|runs|last exit code|program) =/.test(line)).map(line=>line.trim()):[]}));
}else if(mode==='install'){
 if(process.platform!=='darwin')throw Error('O executor local usa o launchd deste Mac.');
 const options={};
 const args=process.argv.slice(3);
 for(let i=0;i<args.length;i+=2){
  if(!['--workspace-id','--site-id'].includes(args[i])||!args[i+1]||options[args[i]])throw Error('Informe --workspace-id UUID e --site-id ID_DO_SITE.');
  options[args[i]]=args[i+1];
 }
 const workspaceId=options['--workspace-id'],siteId=options['--site-id'];
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(workspaceId||'')||!/^appgprj_[a-zA-Z0-9]+$/.test(siteId||''))throw Error('Informe --workspace-id UUID e --site-id ID_DO_SITE.');
 await readFile(resolve(root,'scripts/local-live-sync.mjs'));
 await mkdir(dirname(plist),{recursive:true});await mkdir(logs,{recursive:true,mode:0o700});
 const xml=`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>${escape(process.execPath)}</string><string>${escape(resolve(root,'scripts/local-live-sync.mjs'))}</string><string>--workspace-id</string><string>${escape(workspaceId)}</string><string>--site-id</string><string>${escape(siteId)}</string></array>
<key>WorkingDirectory</key><string>${escape(root)}</string>
<key>EnvironmentVariables</key><dict><key>HOME</key><string>${escape(homedir())}</string><key>PATH</key><string>${escape(dirname(process.execPath))}:/usr/bin:/bin:/usr/sbin:/sbin</string><key>LANG</key><string>en_US.UTF-8</string></dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>30</integer><key>ProcessType</key><string>Background</string>
<key>StandardOutPath</key><string>${escape(resolve(logs,'live-sync.log'))}</string>
<key>StandardErrorPath</key><string>${escape(resolve(logs,'live-sync-error.log'))}</string>
</dict></plist>\n`;
 // Replace only this named service; the review heartbeat remains untouched.
 const previous=run(['print',target]);
 if(previous.status===0){const stopped=run(['bootout',target]);if(stopped.status!==0)throw Error('Não foi possível parar a versão anterior do sincronizador.');}
 await writeFile(plist,xml,{mode:0o600});
 const result=run(['bootstrap',domain,plist]);if(result.status!==0)throw Error('Não foi possível iniciar o sincronizador local no launchd.');
 console.log(JSON.stringify({installed:true,label,plist,logs}));
}else if(mode==='stop'){
 const result=run(['bootout',target]);if(result.status!==0)throw Error('O sincronizador não está carregado ou não pôde ser interrompido.');
 console.log(JSON.stringify({stopped:true,label}));
}else throw Error('Use status, install ou stop.');
