/** Live data only supplies today's display. Analysis snapshots remain untouched. */
export function currentLiveSnapshot(item,project,analysis,now=Date.now()){
 const snapshot=item?.snapshot;
 if(!snapshot||item.projectId!==project||snapshot.projectId!==project||snapshot.source!=='Malva MCP'||snapshot.period!=='today'||snapshot.level!=='campaign'||snapshot.complete!==true||!Array.isArray(snapshot.rows))return null;
 const fetched=Date.parse(snapshot.fetchedAt),from=Date.parse(snapshot.from),to=Date.parse(snapshot.to),previous=Date.parse(analysis?.fetchedAt||'');
 if(!Number.isFinite(fetched)||fetched>now+300000||!Number.isFinite(from)||!Number.isFinite(to)||from>now||to<=now||Number.isFinite(previous)&&fetched<=previous)return null;
 try{
  const day=new Intl.DateTimeFormat('en-CA',{timeZone:snapshot.timezone});
  if(day.format(fetched)!==day.format(now)||day.format(from)!==day.format(now))return null;
 }catch{return null;}
 return snapshot;
}

/** Recent success proves only that data was collected, never that a Mac is online. */
export function liveDisplayStatus(item,project,{error='',paused=false,now=Date.now()}={}){
 const success=Date.parse(item?.lastSuccessAt||''),failure=error||item?.error?.message||'';
 const recent=!paused&&!failure&&!!currentLiveSnapshot(item,project,undefined,now)&&Number.isFinite(success)&&success<=now+300000&&now-success<=180000;
 const label=paused?'Pausado no Bunker':failure?(!error&&item?.error?.code==='SOURCE_CHANGED'?'Conferindo alterações':'Falha de sincronização'):recent?'Dados recentes':item?.lastSuccessAt?'Sem atualização recente do Mac':'Aguardando primeira coleta';
 return {recent,label,error:failure};
}
