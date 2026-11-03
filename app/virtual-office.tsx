'use client';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import type {Dispatch,KeyboardEvent,SetStateAction} from 'react';
import {ArrowDown,ArrowLeft,ArrowRight,ArrowUp,Clock3,FileText,MessageSquare,Pause,Play,Send,Sparkles,X} from 'lucide-react';
import VirtualWorld from './virtual-world';
import CollaborationPanel from './collaboration-panel';
import {officeAgents,agentPresence,officePresencePlan,nearestAgent,planWalk,isWalkable} from '../lib/office.mjs';
import {cadenceOf} from '../lib/cadence.mjs';
import {officeDecisionView} from '../lib/office-decision-view.mjs';
import './virtual-office.css';
type Point={x:number;y:number};
type Props={state:any;project:string;projectName:string;write:(input:any)=>Promise<boolean>;saving:boolean;liveItems?:any[];showReports:()=>void;drafts:Record<string,string>;setDrafts:Dispatch<SetStateAction<Record<string,string>>>};
const stamp=(v?:string)=>v?new Date(v).toLocaleString('pt-BR',{timeZone:'America/Boa_Vista',dateStyle:'short',timeStyle:'short'}):'Ainda não houve coleta';
const distance=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);
export default function VirtualOffice({state,project,projectName,write,saving,showReports,drafts,setDrafts,liveItems=[]}:Props){
 const [position,setPosition]=useState<Point>({x:500,y:300}),[path,setPath]=useState<Point[]>([]),[targetAgent,setTargetAgent]=useState<string|null>(null),[selectedId,setSelectedId]=useState<string|null>(null);
 const [hintsByProject,setHintsByProject]=useState<Record<string,string>>({}),[reduced,setReduced]=useState(false),[localSending,setLocalSending]=useState(false);
 const [presenceTick,setPresenceTick]=useState(0);
 const lastStep=useRef(0),sendLock=useRef(false),composer=useRef<HTMLTextAreaElement>(null),conversation=useRef<HTMLDivElement>(null),worldPanel=useRef<HTMLElement>(null);
 const selected=officeAgents.find((a:any)=>a.id===selectedId),near=nearestAgent(position,110),cfg=cadenceOf(state);
 const draftKey=project+':'+(selectedId||''),draft=drafts[draftKey]||'';
 const hint=hintsByProject[project]||'Projeto '+projectName+' selecionado. As conversas pertencem a este projeto.';
 const setHint=useCallback((text:string,scope=project)=>{setHintsByProject(old=>({...old,[scope]:text}));},[project]);
 const projectMessages=state.messages.filter((m:any)=>m.project===project);
 const messages=selected?projectMessages.filter((m:any)=>m.agentId===selected.id||(!m.agentId&&selected.id==='ops')).reverse():[];
 const messageVersion=messages.map((m:any)=>[m.id,m.status,m.answeredAt||''].join(':')).join('|');

 const pendingJob=state.jobs.some((j:any)=>j.project===project&&j.status==='Pendente');
 const unanswered=projectMessages.filter((m:any)=>m.status==='Pendente').length;
 const presences=useMemo(()=>{const now=Date.now(),plan=officePresencePlan(state,project,now);return Object.fromEntries(officeAgents.map((a:any)=>[a.id,agentPresence(state,project,a.id,now,plan)]));},[state,project,presenceTick]);
 const decisions=useMemo(()=>officeDecisionView(state,project,liveItems,Date.now()),[state,project,liveItems,presenceTick]);
 const collecting=Object.values(presences).some((s:any)=>s.label==='Em coleta'),collaborating=Object.values(presences).some((s:any)=>s.label==='Em análise');
 const awaitingApproval=presences.ops?.label==='Aguardando aprovação',running=collecting||collaborating;
 const last=state.agents?.[project]?.lastSuccessAt;
 const reports=state.reports.filter((r:any)=>r.project===project);
 useEffect(()=>{const update=()=>{if(document.visibilityState==='visible')setPresenceTick(t=>t+1);};const timer=setInterval(update,15000);document.addEventListener('visibilitychange',update);return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',update);};},[]);
 useEffect(()=>{const m=window.matchMedia('(prefers-reduced-motion: reduce)');setReduced(m.matches);const change=()=>setReduced(m.matches);m.addEventListener('change',change);return()=>m.removeEventListener('change',change);},[]);
 useEffect(()=>{
  if(!path.length){
   if(targetAgent){const a=officeAgents.find((x:any)=>x.id===targetAgent);if(a&&distance(position,a)<115){setSelectedId(a.id);setHint('Você chegou à sala de '+a.name+'.');}setTargetAgent(null);}
   return;
  }
  const timer=setTimeout(()=>{setPosition(path[0]);setPath(p=>p.slice(1));},reduced?0:45);
  return()=>clearTimeout(timer);
 },[path,targetAgent,position,reduced,setHint]);
 useEffect(()=>{setPath([]);setTargetAgent(null);},[project,projectName]);
 useEffect(()=>{conversation.current?.scrollTo({top:conversation.current.scrollHeight,behavior:reduced?'auto':'smooth'});},[messageVersion,selectedId,project,reduced]);
 useEffect(()=>{if(selectedId){composer.current?.focus({preventScroll:true});document.getElementById('agent-conversation')?.scrollIntoView({behavior:reduced?'auto':'smooth',block:'nearest'});}},[selectedId,project,reduced]);
 function closeConversation(){setSelectedId(null);worldPanel.current?.scrollIntoView({behavior:reduced?'auto':'smooth',block:'start'});(worldPanel.current?.querySelector('[aria-label="Mapa do escritório virtual"]') as HTMLElement|null)?.focus({preventScroll:true});}
 function walkTo(point:Point){setTargetAgent(null);setSelectedId(null);setPath(planWalk(position,point));}
 function approach(id:string){
  const a=officeAgents.find((v:any)=>v.id===id);if(!a)return;
  setHint('Indo conversar com '+a.name+'…');
  if(distance(position,a)<115){setPath([]);setTargetAgent(null);setSelectedId(id);setHint('Conversa com '+a.name+'.');return;}
  const route=planWalk(position,{x:a.x,y:a.y+40});
  if(!route.length){setHint('Use os corredores para chegar à sala de '+a.name+'.');return;}
  setTargetAgent(id);setPath(route);
 }
 function step(dx:number,dy:number){
  setPath([]);setTargetAgent(null);const next={x:position.x+dx,y:position.y+dy};
  if(isWalkable(next)){setPosition(next);if(selected&&distance(next,selected)>130)setSelectedId(null);}
 }
 function keys(event:KeyboardEvent<HTMLDivElement>){
  if(event.target!==event.currentTarget||event.altKey||event.ctrlKey||event.metaKey)return;
  const key=event.key.toLowerCase(),directions:Record<string,[number,number]>={arrowup:[0,-20],w:[0,-20],arrowdown:[0,20],s:[0,20],arrowleft:[-20,0],a:[-20,0],arrowright:[20,0],d:[20,0]};
  if(directions[key]){event.preventDefault();if(Date.now()-lastStep.current<65)return;lastStep.current=Date.now();step(...directions[key]);}
  else if(key==='e'||key==='enter'){event.preventDefault();if(near)approach(near.id);else setHint('Aproxime-se de um agente ou clique no personagem.');}
  else if(key==='escape')setSelectedId(null);
 }
 async function send(){
  const text=draft.trim(),agentId=selected?.id,key=draftKey,scope=project;
  if(!text||!agentId||!scope||sendLock.current||saving)return;
  sendLock.current=true;setLocalSending(true);
  try{if(await write({op:'message',project:scope,agentId,text})){
   setDrafts(old=>old[key]===draft?{...old,[key]:''}:old);
   setHint('Pergunta registrada para '+selected.name+'. A resposta aparece após a revisão.',scope);
  }}finally{sendLock.current=false;setLocalSending(false);}
 }
 async function request(){const scope=project;if(await write({op:'job',project:scope}))setHint('Revisão do projeto colocada na fila.',scope);}
 const phase=state.paused?'Revisões pausadas':collecting?'Coleta em andamento':collaborating?'Análise da equipe em andamento':awaitingApproval?'Propostas aguardando sua aprovação':pendingJob?'Revisão na fila':decisions.decisionsAvailable?'Sugestões prontas para sua decisão':decisions.rereads?'Releituras pendentes':'Pronto para novos pedidos';
 return <div className={'vo-office'+(selected?' has-conversation':'')}>
  <div className="vo-topline"><div><span className="vo-kicker">BUNKER HQ / SEU ESPAÇO DE OPERAÇÃO</span><h2>Entre. Seu time está por aqui.</h2><p>Quatro especialidades. Um lugar para pensar a próxima decisão.</p></div><div className="vo-presence"><i className={running?'is-busy':''}/><span>{phase}<small>{projectName} · fila conectada</small></span></div></div>
  {decisions.hasAttention&&<section className="vo-decision-summary" aria-label="Próximas decisões do projeto"><div role="status"><strong>{state.paused?'Revisões pausadas':decisions.decisionsAvailable?`${decisions.decisionsAvailable} ${decisions.decisionsAvailable===1?'sugestão para decidir':'sugestões para decidir'}`:'Aguardando releitura'}</strong><p>{state.paused?`${decisions.suggestions} ${decisions.suggestions===1?'sugestão registrada':'sugestões registradas'} · `:''}{decisions.rereads} {decisions.rereads===1?'releitura pendente':'releituras pendentes'}. Confira o contexto no quadro de decisões.</p></div><a href="#cards">Abrir quadro <ArrowRight size={15}/></a></section>}
  <div className="vo-layout">
   <section ref={worldPanel} className="vo-world-panel" aria-label="Escritório dos agentes">
    <VirtualWorld position={position} moving={path.length>0} onMove={walkTo} onAgent={approach} selectedAgent={selectedId||targetAgent} agentStates={presences} onKeyDown={keys} visitorName="Você"/>
    <div className="vo-groundbar"><p aria-live="polite">{path.length?'Caminhando pelo escritório…':near?'Perto de '+near.name+' · pressione E para conversar.':hint}</p><div className="vo-dpad" aria-label="Movimentação"><button onClick={()=>step(-20,0)} aria-label="Andar para a esquerda"><ArrowLeft size={15}/></button><button onClick={()=>step(0,-20)} aria-label="Andar para cima"><ArrowUp size={15}/></button><button onClick={()=>step(0,20)} aria-label="Andar para baixo"><ArrowDown size={15}/></button><button onClick={()=>step(20,0)} aria-label="Andar para a direita"><ArrowRight size={15}/></button></div></div>
    <div className="vo-roster" aria-label="Equipe virtual">{officeAgents.map((a:any)=><button type="button" key={a.id} onClick={()=>approach(a.id)} className={selectedId===a.id?'is-active':''} style={{'--vo-accent':a.color} as any}><span className="vo-roster-avatar">{a.name.slice(0,1)}</span><span><strong>{a.name}</strong><small>{a.role}</small></span><span className="vo-roster-arrow">↗</span></button>)}</div>
   </section>
   <aside className="vo-side" aria-label={selected?'Conversa com '+selected.name:'Central de encontros'}>
    {selected?<section className="vo-conversation" id="agent-conversation">
     <header><div className="vo-agent-portrait" style={{background:selected.color}}>{selected.name.slice(0,1)}</div><div><h3>{selected.name}</h3><p>{selected.role}</p></div><button className="vo-close" onClick={closeConversation} aria-label="Fechar conversa"><X size={17}/></button></header>
     <div className="vo-agent-intro"><span className={'vo-status '+presences[selected.id].tone}>{presences[selected.id].label}</span><p>{selected.description}</p></div>
     <div ref={conversation} className="vo-chat-log" role="log" aria-label={'Histórico com '+selected.name} aria-live="polite">
      {!messages.length&&<div className="vo-chat-empty"><MessageSquare size={24}/><strong>O que vamos olhar juntos?</strong><p>Envie uma pergunta sobre {projectName}. Ela fica registrada para a próxima revisão do agente.</p></div>}
      {messages.map((m:any)=><div className="vo-chat-pair" key={m.id}><div className="vo-chat-bubble vo-yours"><small>Você · {stamp(m.createdAt)}</small><p>{m.text}</p></div>{m.status==='Respondida'&&m.answer?<div className="vo-chat-bubble vo-theirs"><small>{selected.name} · resposta da revisão</small><p>{m.answer}</p><small>{stamp(m.answeredAt)}</small></div>:<div className="vo-chat-wait"><Clock3 size={12}/> Aguardando análise · pergunta na fila</div>}</div>)}
     </div>
     <div className="vo-prompts">{selected.prompts.slice(0,2).map((text:string)=><button type="button" key={text} onClick={()=>{setDrafts(old=>({...old,[draftKey]:text}));composer.current?.focus();}}>{text}</button>)}</div>
     <form className="vo-composer" onSubmit={e=>{e.preventDefault();void send();}}><label htmlFor="virtual-office-message">Mensagem para {selected.name}</label><textarea ref={composer} id="virtual-office-message" aria-label={'Mensagem para '+selected.name} value={draft} onChange={e=>{const value=e.target.value;setDrafts(old=>({...old,[draftKey]:value}));}} maxLength={4000} placeholder="O que você quer analisar?" rows={3} required/><div><small>{projectName} · {draft.length}/4000</small><button type="submit" disabled={!draft.trim()||saving||localSending||!project}><Send size={14}/>{localSending?'Registrando…':'Enviar pergunta'}</button></div></form>
     <p className="vo-queue-note"><Clock3 size={12}/> A pergunta entra na fila do agente conectado. Novas respostas aparecem aqui enquanto o escritório estiver aberto. A conversa é assíncrona.</p>
    </section>:<section className="vo-welcome-card"><div className="vo-welcome-icon"><Sparkles size={28}/></div><span className="vo-kicker">ENCONTRE SEU TIME</span><h3>Cada sala, uma perspectiva.</h3><p>Lia olha a performance. Theo cuida da verba. Nina investiga os criativos. Cai organiza os próximos passos.</p><div className="vo-welcome-rule"/><h4>Como conversar</h4><ol><li>Clique num personagem para chegar até ele.</li><li>Escreva sua pergunta ou escolha uma sugestão.</li><li>Acompanhe a resposta nesta conversa.</li></ol><span className="vo-project-tag">{projectName} · conversas deste projeto</span></section>}
    <section className="vo-round-card"><div><Clock3 size={17}/><h3>Na operação real</h3></div><p>{state.paused?'As revisões estão pausadas. As perguntas continuam salvas para quando o escritório for retomado.':cfg.enabled?'As revisões estão programadas a cada '+(cfg.intervalMinutes<60?cfg.intervalMinutes+' minutos':cfg.intervalMinutes%60===0?cfg.intervalMinutes/60+'h':Math.floor(cfg.intervalMinutes/60)+'h '+cfg.intervalMinutes%60+'min')+', de '+cfg.start+' a '+cfg.end+' ('+cfg.timezone+').':'Agenda automática desativada. Você pode solicitar uma revisão manual.'}</p><dl><div><dt>Última coleta</dt><dd>{stamp(last)}</dd></div><div><dt>Perguntas aguardando</dt><dd>{unanswered}</dd></div><div><dt>Relatórios recentes</dt><dd>{reports.length}</dd></div></dl><div className="vo-round-actions"><button type="button" onClick={request} disabled={saving||!project||state.paused||pendingJob||running}>{pendingJob?'Revisão na fila':collecting?'Coleta em andamento':collaborating?'Equipe em análise':'Solicitar revisão'}</button><button type="button" onClick={showReports}><FileText size={13}/> Ver relatórios</button></div><button type="button" className="vo-pause-link" onClick={()=>write({op:'pause',value:!state.paused})} disabled={saving}>{state.paused?<Play size={13}/>:<Pause size={13}/>} {state.paused?'Retomar revisões':'Pausar revisões'}</button><p className="vo-boundary">As conversas apoiam a decisão. Orçamento e status de campanha seguem sob seu controle.</p></section>
   </aside>
  </div>
  <CollaborationPanel liveItems={liveItems} state={state} project={project} write={write} saving={saving} presentationCards={decisions.cards}/>
 </div>;
}
