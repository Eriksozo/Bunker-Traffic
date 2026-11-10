'use client';
import {useEffect,useRef,useState} from 'react';
import type {CSSProperties,KeyboardEventHandler,PointerEvent} from 'react';
import {Focus,Maximize2,Minus,Plus,RotateCcw,MoveUpRight,Box,MousePointer2,X,Map as MapIcon} from 'lucide-react';
import {officeAgents} from '../lib/office.mjs';
import type {SceneController,Projection} from './world-scene';
import './virtual-world.css';

type Point={x:number;y:number};
type Props={position:Point;moving:boolean;onMove:(point:Point)=>void;onAgent:(id:string)=>void;selectedAgent:string|null;agentStates:Record<string,{label:string;tone:string}>;onKeyDown:KeyboardEventHandler<HTMLDivElement>;visitorName?:string};
const agents=officeAgents as readonly any[];
/* Tom da presença → tom do design system; o glifo acompanha a cor (estado nunca só pela cor). */
const toneOf=(tone?:string)=>tone==='red'||tone==='error'?'bad':tone==='green'||tone==='working'?'good':tone==='amber'||tone==='busy'||tone==='pending'?'warn':'neutral';
const glyphOf=(tone:string)=>tone==='bad'?'bad':tone==='good'?'good':tone==='warn'?'waiting':'info';
export default function VirtualWorld(props:Props){
 const {position,moving,onMove,onAgent,selectedAgent,agentStates,onKeyDown,visitorName='Você'}=props;
 const stage=useRef<HTMLDivElement>(null),shell=useRef<HTMLDivElement>(null),canvas=useRef<HTMLCanvasElement>(null),scene=useRef<SceneController|null>(null),labels=useRef<Record<string,HTMLElement|null>>({}),latest=useRef(props),drag=useRef<{x:number;y:number;lastX:number;lastY:number;id:number;distance:number}|null>(null);
 const [mode,setMode]=useState<'webgl'|'pixel'>('pixel'),[ready,setReady]=useState(false),[error,setError]=useState(''),[zoom,setZoom]=useState(100),[dragging,setDragging]=useState(false),[reduced,setReduced]=useState(false),[full,setFull]=useState(false);
 latest.current=props;
 useEffect(()=>{const query=window.matchMedia('(prefers-reduced-motion: reduce)');setReduced(query.matches);const change=()=>setReduced(query.matches);query.addEventListener('change',change);return()=>query.removeEventListener('change',change);},[]);
 useEffect(()=>{
  let cancelled=false,controller:SceneController|null=null,observer:ResizeObserver|null=null;const surface=canvas.current,container=stage.current;if(!surface||!container)return;
  setReady(false);setError('');
  const project=(points:Projection[])=>{for(const point of points){const label=labels.current[point.id];if(!label)continue;label.style.left=`${point.x}px`;label.style.top=`${point.y}px`;label.style.visibility=point.visible?'visible':'hidden';}};
  const wheel=(event:WheelEvent)=>{event.preventDefault();if(scene.current)setZoom(scene.current.zoom(event.deltaY<0?1.08:1/1.08));};
  const lost=(event:Event)=>{event.preventDefault();if(mode==='webgl'&&!cancelled)setMode('pixel');};
  surface.addEventListener('wheel',wheel,{passive:false});surface.addEventListener('webglcontextlost',lost);
  (mode==='pixel'?import('./gather-scene').then(m=>m.createGatherScene):import('./world-scene').then(m=>m.createWorldScene)).then(createScene=>{
   if(cancelled)return;try{
    controller=createScene(surface,{reduced,project});scene.current=controller;
    const resize=()=>{const rect=container.getBoundingClientRect();controller?.resize(rect.width,rect.height);};observer=new ResizeObserver(resize);observer.observe(container);resize();controller.setVisitor(latest.current.position,latest.current.moving);controller.setStates(latest.current.agentStates);controller.setSelected(latest.current.selectedAgent);setReady(true);
   }catch{if(mode==='webgl')setMode('pixel');else setError('Este dispositivo não conseguiu abrir o cenário. Você pode conversar pela lista da equipe abaixo.');}
  }).catch(()=>{if(!cancelled)setError('Não foi possível carregar o cenário. A lista da equipe continua disponível.');});
  return()=>{cancelled=true;observer?.disconnect();controller?.dispose();if(scene.current===controller)scene.current=null;surface.removeEventListener('wheel',wheel);surface.removeEventListener('webglcontextlost',lost);};
 },[mode,reduced]);
 useEffect(()=>{scene.current?.setVisitor(position,moving);},[position,moving]);
 useEffect(()=>{scene.current?.setStates(agentStates);},[agentStates]);
 useEffect(()=>{scene.current?.setSelected(selectedAgent);},[selectedAgent]);
 useEffect(()=>{const change=()=>setFull(!!document.fullscreenElement&&(document.fullscreenElement===shell.current||document.fullscreenElement===shell.current?.closest('.vo-office')));document.addEventListener('fullscreenchange',change);return()=>document.removeEventListener('fullscreenchange',change);},[]);
 function down(event:PointerEvent<HTMLCanvasElement>){if(event.button!==0)return;drag.current={x:event.clientX,y:event.clientY,lastX:event.clientX,lastY:event.clientY,id:event.pointerId,distance:0};event.currentTarget.setPointerCapture(event.pointerId);}
 function move(event:PointerEvent<HTMLCanvasElement>){const d=drag.current;if(!d||d.id!==event.pointerId)return;d.distance=Math.max(d.distance,Math.hypot(event.clientX-d.x,event.clientY-d.y));if(d.distance>6){setDragging(true);scene.current?.rotate(event.clientX-d.lastX,event.clientY-d.lastY);}d.lastX=event.clientX;d.lastY=event.clientY;}
 function up(event:PointerEvent<HTMLCanvasElement>){const d=drag.current;drag.current=null;setDragging(false);if(!d||d.id!==event.pointerId)return;if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);if(d.distance<=6){const r=event.currentTarget.getBoundingClientRect(),hit=scene.current?.pick(event.clientX-r.left,event.clientY-r.top);if(hit?.agentId)onAgent(hit.agentId);else if(hit?.point)onMove(hit.point);}stage.current?.focus({preventScroll:true});}
 function cancel(){drag.current=null;setDragging(false);}
 function zoomBy(factor:number){if(scene.current)setZoom(scene.current.zoom(factor));}
 function reset(){scene.current?.reset();setZoom(100);stage.current?.focus({preventScroll:true});}
 async function fullscreen(){setError('');try{if(full)await document.exitFullscreen();else await (shell.current?.closest('.vo-office')||shell.current)?.requestFullscreen();}catch{setError('Tela cheia não está disponível neste navegador. O escritório continua funcionando.');}}
 return <div ref={shell} className={`vw-shell vw-immersive vw-${mode} ${full?'is-fullscreen':''}`}>
  <div ref={stage} className={`vw-stage ${dragging?'is-orbiting':''}`} tabIndex={0} role="application" aria-label="Mapa do escritório virtual" aria-describedby="virtual-world-help" onKeyDown={onKeyDown}>
   <canvas key={`${mode}-${reduced?'still':'motion'}`} ref={canvas} className="vw-canvas" aria-label={mode==='pixel'?'Escritório em pixel art com textura de madeira e carpetes':'Cenário tridimensional do escritório virtual'} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel} onContextMenu={e=>e.preventDefault()}/>
   <div className="vw-scene-atmosphere" aria-hidden="true"/>
   <header className="vw-scene-heading vw-float"><span className="vw-world-symbol" aria-hidden="true"><Box size={15}/></span><span className="vw-scene-copy"><small>Bunker · Escritório virtual</small><strong>Seu próximo encontro começa aqui.</strong></span><span className="vw-render-tag ds-pill ds-pill--tag">{mode==='webgl'?'3D imersivo':'Ilustrado'}</span></header>
   <div className="vw-style-controls ds-segmented ds-segmented--sliding" role="group" aria-label="Estilo do ambiente" style={{'--ds-seg-count':2,'--ds-seg-index':mode==='pixel'?0:1} as CSSProperties}><button type="button" aria-label="Ambiente em pixel art" aria-pressed={mode==='pixel'} onClick={()=>{setZoom(100);setMode('pixel');}}><MapIcon size={14}/><span>Ilustrado</span></button><button type="button" aria-label="Ambiente em 3D" aria-pressed={mode==='webgl'} onClick={()=>{setZoom(100);setMode('webgl');}}><Box size={14}/><span>3D</span></button></div>
   <div className="vw-camera-controls vw-float" role="group" aria-label="Câmera do escritório">
    <button type="button" className="ds-btn ds-btn--icon" onClick={()=>zoomBy(1.15)} aria-label="Aproximar câmera" title="Aproximar"><Plus size={16}/></button><span className="vw-zoom ds-num" aria-label={'Zoom '+zoom+' por cento'}>{zoom}%</span><button type="button" className="ds-btn ds-btn--icon" onClick={()=>zoomBy(1/1.15)} aria-label="Afastar câmera" title="Afastar"><Minus size={16}/></button><i aria-hidden="true"/>
    <button type="button" className="ds-btn ds-btn--icon" onClick={reset} aria-label="Restaurar câmera" title="Restaurar vista"><RotateCcw size={15}/></button><button type="button" className="ds-btn ds-btn--icon" onClick={fullscreen} aria-label={full?'Sair da tela cheia':'Abrir escritório em tela cheia'} title="Tela cheia"><Maximize2 size={15}/></button>
   </div>
   {!ready&&!error&&<div className="vw-loading" role="status" aria-busy="true"><span className="vw-loading-rooms" aria-hidden="true"><i className="ds-skeleton ds-skeleton--block"/><i className="ds-skeleton ds-skeleton--block"/><i className="ds-skeleton ds-skeleton--block"/><i className="ds-skeleton ds-skeleton--block"/></span><strong>Preparando seu escritório</strong><small>Luz, espaço e novas perspectivas.</small></div>}
   {error&&<div className="vw-scene-error ds-banner ds-banner--warn" role="status"><div className="ds-banner__body"><strong>{error}</strong></div><button type="button" className="ds-btn ds-btn--icon ds-btn--sm" onClick={()=>setError('')} aria-label="Fechar aviso do cenário"><X size={15}/></button></div>}
   {agents.map(agent=>{const status=agentStates[agent.id]||{label:'Aguardando pedido',tone:'gray'},tone=toneOf(status.tone);return <button key={agent.id} ref={el=>{labels.current[agent.id]=el;}} type="button" className={`vw-agent ${selectedAgent===agent.id?'is-selected':''}`} style={{'--agent-color':agent.color} as CSSProperties} aria-label={`Conversar com ${agent.name}`} aria-pressed={selectedAgent===agent.id} onClick={e=>{e.stopPropagation();onAgent(agent.id);}}><span className="vw-label-top"><i aria-hidden="true"/><strong>{agent.name}</strong><MoveUpRight size={12}/></span><span className="vw-label-role">{agent.role}</span><span className={`vw-agent-state tone-${status.tone} is-${tone}`}><span className={`ds-glyph ds-glyph--${glyphOf(tone)}`} aria-hidden="true"/><span className="vw-agent-state-text">{status.label}</span></span><span className="vw-label-stem" aria-hidden="true"/></button>;})}
   <div ref={el=>{labels.current.visitor=el;}} className="vw-visitor" aria-hidden="true"><span>{visitorName}<small>VOCÊ</small></span><i/></div>
   <div className="vw-compass" aria-hidden="true"><span>N</span><Focus size={20}/><small>Isométrico</small></div>
   <div className="vw-scene-footnote vw-float"><span><MousePointer2 size={12}/> Clique no piso para caminhar</span><span>{mode==='pixel'?'Arraste para explorar o escritório':'Arraste para explorar a arquitetura'}</span></div>
  </div>
  <div className="vw-help" id="virtual-world-help"><span><i aria-hidden="true"/> Espaço de agentes</span><p>Clique para caminhar <b aria-hidden="true">•</b> <kbd>Setas</kbd>/<kbd>WASD</kbd> <b aria-hidden="true">•</b> <kbd>E</kbd> para conversar</p><span className="vw-private-note">As presenças refletem a fila real.</span></div>
 </div>;
}
