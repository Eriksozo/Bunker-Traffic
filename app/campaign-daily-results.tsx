'use client';

import {useEffect,useId,useMemo,useRef,useState,type CSSProperties,type ReactNode} from 'react';
import {Bar,CartesianGrid,ComposedChart,Line,ReferenceLine,ResponsiveContainer,Tooltip as ChartTooltip,XAxis,YAxis} from 'recharts';
import {ChartNoAxesCombined,Info,RefreshCw,Table2} from 'lucide-react';
import {Table,TableBody,TableCell,TableHead,TableHeader,TableRow} from '@/components/ui/table';
import {Tooltip,TooltipContent,TooltipProvider,TooltipTrigger} from '@/components/ui/tooltip';
import {mergeDailyItem} from '../lib/campaign-daily-view.mjs';
import './campaign-daily-results.css';
import CampaignForecast from './campaign-forecast';

type Target={projectId:string;adAccountId:string;objectId:string};
type DayRow={day:string;spend:number|null;orders:number|null;cpa:number|null;revenueNet:number|null;profit:number|null;roas:number|null;roi:number|null;impressions?:number|null;linkClicks?:number|null;checkouts?:number|null;cpc?:number|null;cpm?:number|null;costPerCheckout?:number|null};
type Snapshot={source:string;fetchedAt:string;lastSyncAt:string|null;timezone:string;currency:string|null;from:string;to:string;rows:DayRow[]};
type Item={target:Target&{internalObjectId?:string;timezone?:string};range:{from:string;to:string};snapshot?:Snapshot|null;error?:string|{message?:string}|null;revision?:number;status?:string;stale?:boolean;refreshPending?:boolean};
type Reading={identity:string;item:Item|null;paused:boolean;loading:boolean;refreshing:boolean;error:string|null};
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const dayPattern=/^\d{4}-\d{2}-\d{2}$/;
const dayLabel=(day:string)=>dayPattern.test(day)?`${day.slice(8,10)}/${day.slice(5,7)}`:'N/D';
const count=(v:unknown)=>finite(v)?v.toLocaleString('pt-BR',{maximumFractionDigits:0}):'N/D';
const ratio=(v:unknown)=>finite(v)?v.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})+'x':'N/D';
const validCurrency=(v:unknown):v is string=>typeof v==='string'&&/^[A-Z]{3}$/.test(v);
function money(v:unknown,currency:string|null){if(!finite(v)||!validCurrency(currency))return 'N/D';try{return new Intl.NumberFormat('pt-BR',{style:'currency',currency,maximumFractionDigits:2}).format(v);}catch{return 'N/D';}}
function civilDay(value:string,timezone:string){try{const parts=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value));return ['year','month','day'].map(type=>parts.find(p=>p.type===type)?.value).join('-');}catch{return null;}}
function stamp(value:string|null|undefined,timezone:string){if(!value||!Number.isFinite(Date.parse(value)))return 'N/D';try{return new Intl.DateTimeFormat('pt-BR',{timeZone:timezone,dateStyle:'short',timeStyle:'short'}).format(new Date(value));}catch{return 'N/D';}}
function sourceRange(snapshot:Snapshot|null,range:Item['range']|undefined){
 if(snapshot){const from=dayPattern.test(snapshot.from)?snapshot.from:civilDay(snapshot.from,snapshot.timezone),to=dayPattern.test(snapshot.to)?snapshot.to:Number.isFinite(Date.parse(snapshot.to))?civilDay(new Date(Date.parse(snapshot.to)-1).toISOString(),snapshot.timezone):null;if(from&&to&&dayPattern.test(from)&&dayPattern.test(to))return {from,to};}
 return range&&dayPattern.test(range.from)&&dayPattern.test(range.to)?range:null;
}
function rangeDays(range:{from:string;to:string}|null){
 if(!range)return [];
 const end=Date.parse(range.to+'T00:00:00Z'),start=Date.parse(range.from+'T00:00:00Z');if(!Number.isFinite(end)||!Number.isFinite(start)||end<start)return [];
 const result:string[]=[];for(let at=end;at>=start&&result.length<7;at-=86400000)result.push(new Date(at).toISOString().slice(0,10));return result;
}
function pending(item:Item|null){return item?.refreshPending===true||/pend|fila|colet|an[aá]lis|aguard|running|loading|queued|requested/i.test(item?.status||'');}
function errorText(value:Item['error']){return typeof value==='string'?value.slice(0,260):value&&typeof value.message==='string'?value.message.slice(0,260):null;}
function sameTarget(value:unknown,target:Target){const t=value as Target|undefined;return !!t&&t.projectId===target.projectId&&t.adAccountId===target.adAccountId&&t.objectId===target.objectId;}
/** N/D stays N/D (never zero), shown muted so real figures stand out. */
const na=(text:string):ReactNode=>text==='N/D'?<span className="cdr-na">N/D</span>:text;
const glyph=(tone:'good'|'bad'|'warn'|'waiting'|'info')=><span className={'ds-glyph ds-glyph--'+tone} aria-hidden="true"/>;
/** Profit: tone colour plus glyph, so the state never relies on colour alone. */
function Signed({value,text}:{value:unknown;text:string}){const tone=finite(value)?value>0?'good':value<0?'bad':null:null;return tone?<span className={'cdr-signed cdr-signed-'+tone}>{glyph(tone)}{text}</span>:<>{na(text)}</>;}
function InfoHint({label,children}:{label:string;children:ReactNode}){return <Tooltip><TooltipTrigger asChild><button type="button" className="cdr-info" aria-label={label}><Info size={13}/></button></TooltipTrigger><TooltipContent sideOffset={6}>{children}</TooltipContent></Tooltip>;}
function ChartDetails({active,payload,currency,today}:{active?:boolean;payload?:any[];currency:string|null;today:string|null}){
 const row=payload?.find(p=>p.payload)?.payload as DayRow|undefined;if(!active||!row)return null;
 return <div className="cdr-chart-tooltip ds-popover"><strong>{dayLabel(row.day)}{row.day===today?' · parcial':''}</strong><dl><div><dt>Investimento</dt><dd>{na(money(row.spend,currency))}</dd></div><div><dt>Fat. líquido</dt><dd>{na(money(row.revenueNet,currency))}</dd></div><div><dt>Lucro</dt><dd className={finite(row.profit)?row.profit>0?'cdr-positive':row.profit<0?'cdr-negative':'':''}><Signed value={row.profit} text={money(row.profit,currency)}/></dd></div><div><dt>Vendas · pedidos</dt><dd>{na(count(row.orders))}</dd></div><div><dt>ROAS / ROI</dt><dd>{na(ratio(row.roas))} / {na(ratio(row.roi))}</dd></div></dl></div>;
}

/** Display-only cache: no results here supply analysis, decisions or approvals. */
export default function CampaignDailyResults({card,state,now,...target}:Target&{card?:any;state?:any;now?:number}){
 const identity=JSON.stringify([target.projectId,target.adAccountId,target.objectId]),headingId=useId(),viewId=useId();
 const [view,setView]=useState<'table'|'chart'>('table');
 const [reading,setReading]=useState<Reading>({identity,item:null,paused:false,loading:true,refreshing:false,error:null});
 const refresh=useRef<null|(()=>void)>(null);
 useEffect(()=>{
  let closed=false,inFlight=false,queued=false,timer:ReturnType<typeof setTimeout>|undefined,latest:Item|null=null,paused=false;
  const controllers=new Set<AbortController>();
  setReading({identity,item:null,paused:false,loading:true,refreshing:false,error:null});setView('table');
  async function load(request=false){
   if(closed)return;if(inFlight){if(request)queued=true;return;}inFlight=true;if(timer)clearTimeout(timer);
   if(request)setReading(old=>old.identity===identity?{...old,refreshing:true}:old);
   const controller=new AbortController();controllers.add(controller);let requestFailed=false,timedOut=false;
   let deadlineTimer:ReturnType<typeof setTimeout>|undefined,onAbort=()=>{};
   const aborted=new Promise<never>((_,reject)=>{
    onAbort=()=>reject(new DOMException('Consulta cancelada.','AbortError'));
    controller.signal.addEventListener('abort',onAbort,{once:true});
    deadlineTimer=setTimeout(()=>{timedOut=true;controller.abort();},18000);
   });
   try{
    const params=new URLSearchParams(target);
    const requestResult=(async()=>{
     const response=await fetch(request?'/api/campaign-daily':'/api/campaign-daily?'+params,{method:request?'POST':'GET',cache:'no-store',signal:controller.signal,...(request?{headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'request',...target})}:{})});
     if(!response.ok)throw Error(response.status===401?'Sua sessão expirou. Atualize a página para consultar os resultados.':'Não foi possível atualizar os resultados por dia.');
     return await response.json() as {paused?:boolean;item?:Item|null};
    })();
    const result=await Promise.race([requestResult,aborted]);if(closed)return;
    if(result.item&&!sameTarget(result.item.target,target))throw Error('A leitura recebida não corresponde a esta campanha.');
    latest=mergeDailyItem(latest,result.item||null);
    paused=result.paused===true;setReading({identity,item:latest,paused,loading:false,refreshing:false,error:null});
   }catch(error){requestFailed=request;if(!closed&&(timedOut||!(error instanceof DOMException&&error.name==='AbortError')))setReading(old=>old.identity===identity?{...old,loading:false,refreshing:false,error:timedOut?'A consulta demorou mais que o esperado. Tente atualizar novamente.':error instanceof Error?error.message:'A leitura está indisponível no momento.'}:old);}
   finally{if(deadlineTimer)clearTimeout(deadlineTimer);controller.signal.removeEventListener('abort',onAbort);controllers.delete(controller);inFlight=false;if(!closed){if(queued){queued=false;void load(true);}else timer=setTimeout(()=>void load(false),requestFailed?0:pending(latest)?5000:10000);}}
  }
  refresh.current=()=>void load(true);void load(true);
  const requestTimer=setInterval(()=>{if(!paused)void load(true);},60000);
  return()=>{closed=true;refresh.current=null;clearInterval(requestTimer);if(timer)clearTimeout(timer);for(const controller of controllers)controller.abort();};
 },[identity,target.projectId,target.adAccountId,target.objectId]);
 const current=reading.identity===identity?reading:null,item=current?.item||null,snapshot=item?.snapshot||null;
 const range=sourceRange(snapshot,item?.range),today=snapshot?civilDay(new Date().toISOString(),snapshot.timezone):null;
 const rows=useMemo(()=>{const byDay=new Map<string,DayRow|null>();for(const row of snapshot?.rows||[]){if(!dayPattern.test(row.day))continue;byDay.set(row.day,byDay.has(row.day)?null:row);}return rangeDays(range).map(day=>({day,row:byDay.get(day)||null}));},[snapshot,range?.from,range?.to]);
 const currency=snapshot?.currency||null,isPending=pending(item),error=current?.error||errorText(item?.error),loading=!current||current.loading;
 const chartRows=rows.slice().reverse().map(({day,row})=>({day,spend:row?.spend??null,revenueNet:row?.revenueNet??null,profit:row?.profit??null,orders:row?.orders??null,roas:row?.roas??null,roi:row?.roi??null}));
 const hasData=rows.some(({row})=>row&&Object.values(row).some(finite)),hasChartData=validCurrency(currency)&&chartRows.some(r=>finite(r.spend)||finite(r.revenueNet)||finite(r.profit));
 return <><CampaignForecast card={card} state={state} item={item} now={Math.max(now??0,Date.now())} paused={current?.paused===true} error={error}/><TooltipProvider delayDuration={180}><section className="campaign-daily-results ds-card" aria-labelledby={headingId}>
  <header className="cdr-heading"><div className="cdr-heading-copy"><h4 id={headingId} className="ds-title">Resultado por dia <InfoHint label="Como ler o resultado por dia">Vendas são pedidos atribuídos, incluindo upsells. IC é checkout iniciado. Custo IC, CPC e CPM dividem os gastos do dia por IC, cliques no link e mil impressões.</InfoHint></h4><p className="ds-caption">{range?`${dayLabel(range.from)} – ${dayLabel(range.to)}`:'Últimos 7 dias, incluindo hoje'}{snapshot?.timezone&&<span> · {snapshot.timezone}</span>}</p></div><div className="cdr-controls"><div className="cdr-view-toggle ds-segmented ds-segmented--sliding" role="group" aria-label="Visualização dos resultados" style={{'--ds-seg-count':2,'--ds-seg-index':view==='chart'?0:1} as CSSProperties}><button type="button" aria-pressed={view==='chart'} aria-controls={viewId} onClick={()=>setView('chart')}><ChartNoAxesCombined size={14} aria-hidden="true"/>Gráfico</button><button type="button" aria-pressed={view==='table'} aria-controls={viewId} onClick={()=>setView('table')}><Table2 size={14} aria-hidden="true"/>Tabela</button></div><button type="button" className="cdr-refresh ds-btn ds-btn--icon" aria-label="Atualizar resultados por dia" title="Solicitar nova leitura" disabled={current?.refreshing||loading} aria-busy={current?.refreshing||undefined} onClick={()=>refresh.current?.()}>{current?.refreshing?<span className="ds-spinner" aria-hidden="true"/>:<RefreshCw size={15} aria-hidden="true"/>}</button></div></header>
  <div className="cdr-reading-status" role="status" aria-live="polite">{current?.paused?<span>{glyph('waiting')}Escritório pausado. A última leitura disponível foi preservada.</span>:error?<span className="cdr-status-error">{glyph('bad')}<span>{error}{snapshot?' A última leitura disponível foi preservada.':''}</span></span>:isPending?<span>{glyph('waiting')} Atualização pendente{snapshot?'. Exibindo a última leitura.':'. Aguardando dados da fonte.'}</span>:snapshot?<span>{item?.stale?glyph('warn'):<span className="ds-dot ds-dot--good ds-dot--sm" aria-hidden="true"/>}<span>{item?.stale?'Leitura desatualizada · ':''}Malva · leitura {stamp(snapshot.fetchedAt,snapshot.timezone)}</span></span>:!loading?<span>{glyph('info')}Ainda não há leitura disponível para esta campanha.</span>:null}</div>
  <div id={viewId} className="cdr-view" aria-busy={loading}>
   {loading&&!snapshot?<div className="cdr-skeleton" role="status" aria-label="Carregando resultado por dia"><span className="dc-sr-only ds-sr-only">Carregando resultado por dia.</span>{Array.from({length:7},(_,i)=><div key={i}>{Array.from({length:5},(_,j)=><span key={j} className="ds-skeleton ds-skeleton--text" aria-hidden="true"/>)}</div>)}</div>:!snapshot?<div className={'cdr-empty ds-empty ds-empty--block '+(error?'cdr-empty--error':'ds-empty--waiting')}><strong>{error?'Leitura indisponível':'Aguardando resultado por dia'}</strong><p>Os valores aparecem após a consulta da fonte. Dados ausentes ficam como N/D.</p></div>:view==='table'?<div className="cdr-table-scroll" tabIndex={0} role="region" aria-label="Tabela dos resultados por dia"><Table className="cdr-table"><caption className="dc-sr-only ds-sr-only">Resultado diário desta campanha: gastos, ROAS, vendas, IC, custo por IC, CPC e CPM. Vendas incluem pedidos de upsell. Hoje é parcial.</caption><TableHeader><TableRow><TableHead scope="col">Dia</TableHead><TableHead scope="col">Gastos</TableHead><TableHead scope="col">ROAS</TableHead><TableHead scope="col">Vendas <InfoHint label="O que significa Vendas">Total de pedidos atribuídos no dia, incluindo upsells. Não é a contagem de compradores nem apenas vendas front.</InfoHint></TableHead><TableHead scope="col">IC <InfoHint label="O que significa IC">Checkouts iniciados no dia, vindos de clique de anúncio, como a Malva conta.</InfoHint></TableHead><TableHead scope="col">Custo IC <InfoHint label="Como é calculado o Custo IC">Gastos do dia divididos pelo IC. Sem IC confirmado, fica N/D.</InfoHint></TableHead><TableHead scope="col">CPC <InfoHint label="Como é calculado o CPC">Gastos do dia divididos pelos cliques no link.</InfoHint></TableHead><TableHead scope="col">CPM <InfoHint label="Como é calculado o CPM">Gastos do dia para cada mil impressões.</InfoHint></TableHead></TableRow></TableHeader><TableBody>{rows.map(({day,row})=><TableRow key={day} className={day===today?'cdr-today':undefined}><TableHead scope="row" className="cdr-day">{dayLabel(day)}{day===today&&<span className="cdr-partial ds-pill">{glyph('waiting')}Parcial</span>}</TableHead><TableCell>{na(money(row?.spend,currency))}</TableCell><TableCell>{na(ratio(row?.roas))}</TableCell><TableCell>{na(count(row?.orders))}</TableCell><TableCell>{na(count(row?.checkouts))}</TableCell><TableCell>{na(money(row?.costPerCheckout,currency))}</TableCell><TableCell>{na(money(row?.cpc,currency))}</TableCell><TableCell>{na(money(row?.cpm,currency))}</TableCell></TableRow>)}</TableBody></Table></div>:hasChartData?<><div className="cdr-chart-scroll" tabIndex={0} role="region" aria-label="Gráfico diário em valores monetários"><div className="cdr-chart"><ResponsiveContainer width="100%" height={250}><ComposedChart accessibilityLayer data={chartRows} margin={{top:12,right:16,bottom:8,left:3}}><CartesianGrid stroke="var(--ds-stroke)" vertical={false}/><XAxis dataKey="day" tickFormatter={dayLabel} tick={{fill:'var(--ds-ink-muted)',fontSize:11}} axisLine={false} tickLine={false} tickMargin={10}/><YAxis width={65} tickFormatter={v=>finite(v)?new Intl.NumberFormat('pt-BR',{notation:'compact',maximumFractionDigits:1}).format(v):''} tick={{fill:'var(--ds-ink-muted)',fontSize:11}} axisLine={false} tickLine={false}/><ChartTooltip content={<ChartDetails currency={currency} today={today}/>} cursor={{fill:'var(--ds-fill-hover)'}}/><ReferenceLine y={0} stroke="var(--ds-stroke-strong)"/><Bar dataKey="spend" name="Investimento" fill="var(--ds-ink-muted)" radius={[3,3,0,0]} maxBarSize={24}/><Bar dataKey="revenueNet" name="Fat. líquido" fill="var(--ds-good)" radius={[3,3,0,0]} maxBarSize={24}/><Line dataKey="profit" name="Lucro" stroke="var(--ds-accent)" strokeWidth={2} dot={{r:3,strokeWidth:0,fill:'var(--ds-accent)'}} activeDot={{r:5,fill:'var(--ds-accent)'}} connectNulls={false}/></ComposedChart></ResponsiveContainer></div></div><div className="cdr-chart-legend"><span><i className="cdr-legend-spend" aria-hidden="true"/>Investimento</span><span><i className="cdr-legend-revenue" aria-hidden="true"/>Fat. líquido</span><span><i className="cdr-legend-profit" aria-hidden="true"/>Lucro</span><small>Valores em {currency}. ROAS e ROI no detalhe de cada dia.</small></div></>:<div className="cdr-empty ds-empty ds-empty--block"><strong>{validCurrency(currency)?'Sem dados confirmados para o gráfico':'Moeda da fonte não confirmada'}</strong><p>Consulte a tabela para ver os dias disponíveis.</p></div>}
  </div>
  {snapshot&&<footer className="cdr-foot"><span>{!hasData?'Nenhum dia com valores confirmados. ':''}Hoje é parcial. Dias sem leitura aparecem como N/D.</span><small>Fonte: {snapshot.source||'N/D'} · Leitura {stamp(snapshot.fetchedAt,snapshot.timezone)}{snapshot.lastSyncAt?` · Sincronização ${stamp(snapshot.lastSyncAt,snapshot.timezone)}`:''}. Acompanhamento separado da análise.</small></footer>}
 </section></TooltipProvider></>;
}
