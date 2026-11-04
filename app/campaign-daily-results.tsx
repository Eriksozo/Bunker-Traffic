'use client';

import {useEffect,useId,useMemo,useRef,useState,type ReactNode} from 'react';
import {Bar,CartesianGrid,ComposedChart,Line,ReferenceLine,ResponsiveContainer,Tooltip as ChartTooltip,XAxis,YAxis} from 'recharts';
import {ChartNoAxesCombined,Info,Loader2,RefreshCw,Table2} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Table,TableBody,TableCell,TableHead,TableHeader,TableRow} from '@/components/ui/table';
import {Tooltip,TooltipContent,TooltipProvider,TooltipTrigger} from '@/components/ui/tooltip';
import {mergeDailyItem} from '../lib/campaign-daily-view.mjs';
import './campaign-daily-results.css';
import CampaignForecast from './campaign-forecast';

type Target={projectId:string;adAccountId:string;objectId:string};
type DayRow={day:string;spend:number|null;orders:number|null;cpa:number|null;revenueNet:number|null;profit:number|null;roas:number|null;roi:number|null};
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
function InfoHint({label,children}:{label:string;children:ReactNode}){return <Tooltip><TooltipTrigger asChild><button type="button" className="cdr-info" aria-label={label}><Info size={13}/></button></TooltipTrigger><TooltipContent sideOffset={6}>{children}</TooltipContent></Tooltip>;}
function ChartDetails({active,payload,currency,today}:{active?:boolean;payload?:any[];currency:string|null;today:string|null}){
 const row=payload?.find(p=>p.payload)?.payload as DayRow|undefined;if(!active||!row)return null;
 return <div className="cdr-chart-tooltip"><strong>{dayLabel(row.day)}{row.day===today?' · parcial':''}</strong><dl><div><dt>Investimento</dt><dd>{money(row.spend,currency)}</dd></div><div><dt>Fat. líquido</dt><dd>{money(row.revenueNet,currency)}</dd></div><div><dt>Lucro</dt><dd className={finite(row.profit)?row.profit>0?'cdr-positive':row.profit<0?'cdr-negative':'':''}>{money(row.profit,currency)}</dd></div><div><dt>Vendas · pedidos</dt><dd>{count(row.orders)}</dd></div><div><dt>ROAS / ROI</dt><dd>{ratio(row.roas)} / {ratio(row.roi)}</dd></div></dl></div>;
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
 return <><CampaignForecast card={card} state={state} item={item} now={Math.max(now??0,Date.now())} paused={current?.paused===true} error={error}/><TooltipProvider delayDuration={180}><section className="campaign-daily-results" aria-labelledby={headingId}>
  <header className="cdr-heading"><div><h4 id={headingId}>Resultado por dia <InfoHint label="Como ler o resultado por dia">Vendas são pedidos atribuídos, incluindo upsells. CPA é investimento dividido pelo total de pedidos. O quadro não representa apenas vendas front.</InfoHint></h4><p>{range?`${dayLabel(range.from)} – ${dayLabel(range.to)}`:'Últimos 7 dias, incluindo hoje'}{snapshot?.timezone&&<span> · {snapshot.timezone}</span>}</p></div><div className="cdr-controls"><div className="cdr-view-toggle" role="group" aria-label="Visualização dos resultados"><Button type="button" variant="ghost" aria-pressed={view==='chart'} aria-controls={viewId} onClick={()=>setView('chart')}><ChartNoAxesCombined size={14}/>Gráfico</Button><Button type="button" variant="ghost" aria-pressed={view==='table'} aria-controls={viewId} onClick={()=>setView('table')}><Table2 size={14}/>Tabela</Button></div><Button type="button" variant="ghost" className="cdr-refresh" aria-label="Atualizar resultados por dia" title="Solicitar nova leitura" disabled={current?.refreshing||loading} onClick={()=>refresh.current?.()}>{current?.refreshing?<Loader2 size={15} className="spin"/>:<RefreshCw size={15}/>}</Button></div></header>
  <div className="cdr-reading-status" role="status" aria-live="polite">{current?.paused?'Escritório pausado. A última leitura disponível foi preservada.':error?<span>{error}{snapshot?' A última leitura disponível foi preservada.':''}</span>:isPending?<span><Loader2 size={12} className="spin"/> Atualização pendente{snapshot?'. Exibindo a última leitura.':'. Aguardando dados da fonte.'}</span>:snapshot?<span>{item?.stale?'Leitura desatualizada · ':''}Malva · leitura {stamp(snapshot.fetchedAt,snapshot.timezone)}</span>:!loading?'Ainda não há leitura disponível para esta campanha.':null}</div>
  <div id={viewId} className="cdr-view" aria-busy={loading}>
   {loading&&!snapshot?<div className="cdr-skeleton" role="status" aria-label="Carregando resultado por dia"><span className="dc-sr-only">Carregando resultado por dia.</span>{Array.from({length:7},(_,i)=><div key={i}><i/><i/><i/><i/><i/></div>)}</div>:!snapshot?<div className="cdr-empty"><Table2 size={22}/><strong>{error?'Leitura indisponível':'Aguardando resultado por dia'}</strong><p>Os valores aparecem após a consulta da fonte. Dados ausentes ficam como N/D.</p></div>:view==='table'?<div className="cdr-table-scroll" tabIndex={0} role="region" aria-label="Tabela dos resultados por dia"><Table className="cdr-table"><caption className="dc-sr-only">Resultado diário desta campanha. Vendas incluem pedidos de upsell. Hoje é parcial.</caption><TableHeader><TableRow><TableHead scope="col">DIA</TableHead><TableHead scope="col">INVESTIMENTO</TableHead><TableHead scope="col">VENDAS <InfoHint label="O que significa Vendas">Total de pedidos atribuídos no dia, incluindo upsells. Não é a contagem de compradores nem apenas vendas front.</InfoHint></TableHead><TableHead scope="col">CPA <InfoHint label="Como é calculado o CPA">Investimento em mídia dividido pelo total de pedidos do dia. Não é CPA Front. Sem denominador confirmado, fica N/D.</InfoHint></TableHead><TableHead scope="col">FAT. LÍQUIDO</TableHead><TableHead scope="col">LUCRO</TableHead><TableHead scope="col">ROAS</TableHead><TableHead scope="col">ROI</TableHead></TableRow></TableHeader><TableBody>{rows.map(({day,row})=><TableRow key={day}><TableHead scope="row" className="cdr-day">{dayLabel(day)}{day===today&&<span className="cdr-partial">Parcial</span>}</TableHead><TableCell>{money(row?.spend,currency)}</TableCell><TableCell>{count(row?.orders)}</TableCell><TableCell>{money(row?.cpa,currency)}</TableCell><TableCell>{money(row?.revenueNet,currency)}</TableCell><TableCell className={finite(row?.profit)?row.profit>0?'cdr-positive':row.profit<0?'cdr-negative':'':''}>{money(row?.profit,currency)}</TableCell><TableCell>{ratio(row?.roas)}</TableCell><TableCell className={finite(row?.roi)?row.roi>=1?'cdr-positive':'cdr-negative':''}>{ratio(row?.roi)}</TableCell></TableRow>)}</TableBody></Table></div>:hasChartData?<><div className="cdr-chart-scroll" tabIndex={0} role="region" aria-label="Gráfico diário em valores monetários"><div className="cdr-chart"><ResponsiveContainer width="100%" height={250}><ComposedChart accessibilityLayer data={chartRows} margin={{top:12,right:16,bottom:8,left:3}}><CartesianGrid stroke="var(--border)" vertical={false}/><XAxis dataKey="day" tickFormatter={dayLabel} tick={{fill:'var(--ink-muted)',fontSize:10}} axisLine={false} tickLine={false} tickMargin={10}/><YAxis width={65} tickFormatter={v=>finite(v)?new Intl.NumberFormat('pt-BR',{notation:'compact',maximumFractionDigits:1}).format(v):''} tick={{fill:'var(--ink-muted)',fontSize:10}} axisLine={false} tickLine={false}/><ChartTooltip content={<ChartDetails currency={currency} today={today}/>} cursor={{fill:'var(--surface-hover)'}}/><ReferenceLine y={0} stroke="var(--line-strong)"/><Bar dataKey="spend" name="Investimento" fill="#9868f5" radius={[3,3,0,0]} maxBarSize={24}/><Bar dataKey="revenueNet" name="Fat. líquido" fill="#39bd8d" radius={[3,3,0,0]} maxBarSize={24}/><Line dataKey="profit" name="Lucro" stroke="#d5bcff" strokeWidth={2} dot={{r:3,strokeWidth:0}} activeDot={{r:5}} connectNulls={false}/></ComposedChart></ResponsiveContainer></div></div><div className="cdr-chart-legend"><span><i className="cdr-legend-spend"/>Investimento</span><span><i className="cdr-legend-revenue"/>Fat. líquido</span><span><i className="cdr-legend-profit"/>Lucro</span><small>Valores em {currency}. ROAS e ROI no detalhe de cada dia.</small></div></>:<div className="cdr-empty"><ChartNoAxesCombined size={22}/><strong>{validCurrency(currency)?'Sem dados confirmados para o gráfico':'Moeda da fonte não confirmada'}</strong><p>Consulte a tabela para ver os dias disponíveis.</p></div>}
  </div>
  {snapshot&&<footer className="cdr-foot"><span>{!hasData?'Nenhum dia com valores confirmados. ':''}Hoje é parcial. Dias sem leitura aparecem como N/D.</span><small>Fonte: {snapshot.source||'N/D'} · Leitura {stamp(snapshot.fetchedAt,snapshot.timezone)}{snapshot.lastSyncAt?` · Sincronização ${stamp(snapshot.lastSyncAt,snapshot.timezone)}`:''}. Acompanhamento separado da análise.</small></footer>}
 </section></TooltipProvider></>;
}
