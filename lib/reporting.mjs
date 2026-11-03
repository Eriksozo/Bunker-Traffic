/** Applications with an explicit verification time inside the selected source window. */
export function appliedInWindow(decisions,project,window,now=Date.now()){
 if(!window)return [];
 const from=Date.parse(window.from),to=Date.parse(window.to);
 if(!Number.isFinite(from)||!Number.isFinite(to))return [];
 return decisions.filter(d=>{const at=Date.parse(d.appliedAt||'');return d.project===project&&d.status==='Aplicada pelo operador'&&Number.isFinite(at)&&at>=from&&at<to&&at<=now;});
}
export function verifyDecision(decision,status,confirmed,now){
 if(decision.status===status)return false;
 if(decision.status==='Aplicada pelo operador'||decision.status==='Recusada')throw new Error('Decisão já encerrada. Registre uma nova proposta.');
 if(status==='Aplicada pelo operador'){
  if(decision.status!=='Aprovada'||confirmed!==true)throw new Error('Aprove a proposta e confirme a conferência na plataforma.');
  decision.appliedAt=now;
 }
 decision.status=status;decision.updatedAt=now;return true;
}
