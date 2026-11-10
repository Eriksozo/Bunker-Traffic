'use client';
import {useMemo} from 'react';
import {ChartNoAxesCombined,ChevronDown,Info} from 'lucide-react';
import {forecastCampaign} from '../lib/campaign-forecast.mjs';
import './campaign-forecast.css';
const money=(v:any)=>Number.isFinite(v)?v.toLocaleString('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:0}):'N/D';
const number=(v:any,digits=0)=>Number.isFinite(v)?v.toLocaleString('pt-BR',{maximumFractionDigits:digits}):'N/D';
export default function CampaignForecast({card,state,item,now,paused,error}:{card:any;state:any;item:any;now:number;paused:boolean;error:any}){
 const result=useMemo(()=>forecastCampaign({card,state,item,now,paused,error}),[card,state,item,now,paused,error]);
 if(!card)return null;
 const central=result.scenarios.find((s:any)=>s.id==='central'),tz=item?.snapshot?.timezone||card.liveToday?.timezone||card.windows?.['3d']?.timezone||'America/Sao_Paulo';
 const stamp=(s:any)=>{try{return new Intl.DateTimeFormat('pt-BR',{timeZone:tz,dateStyle:'short',timeStyle:'short'}).format(new Date(s));}catch{return 'N/D';}};
 const glyph=(tone:string)=><span className={'ds-glyph ds-glyph--'+tone} aria-hidden="true"/>;
 const tone=(v:any)=>Number.isFinite(v)?v>=0?'good':'bad':null;
 const trendTone=result.trend.kind==='improving'?'good':result.trend.kind==='weakening'?'warn':'info';
 return <section className="campaign-forecast ds-card" aria-label="Tendência e cenários de fechamento">
  <header className="cf-heading"><div className="cf-heading-copy"><span className="ds-eyebrow cf-eyebrow"><ChartNoAxesCombined size={13} aria-hidden="true"/> Tendência e fechamento</span><h4 className="ds-title">{result.status==='scenario'?'Cenários para fechar o dia':'Projeção em formação'}</h4></div><span className="cf-confidence ds-pill">{glyph('info')}{result.confidence}</span></header>
  {result.trend.kind!=='unknown'&&<p className={'cf-trend cf-trend-'+result.trend.kind}>{glyph(trendTone)}<span><strong>{result.trend.label}</strong> · CPA Front {result.trend.change!>0?'+':''}{number(result.trend.change,1)}% nos 3 dias fechados versus o bloco anterior. Histórico até {stamp(result.trend.through)}.</span></p>}
  <p className="cf-reason">{result.reason}</p>
  {central&&<><div className="cf-central"><div className="ds-kpi ds-kpi--tile"><span className="ds-kpi__label">Resultado central estimado</span><strong className={'ds-kpi__value '+(central.profit>=0?'cf-positive':'cf-negative')}>{tone(central.profit)&&glyph(tone(central.profit)!)}≈ {money(central.profit)}</strong></div><div className="ds-kpi ds-kpi--tile"><span className="ds-kpi__label">Faixa dos cenários</span><strong className="ds-kpi__value">{money(Math.min(...result.scenarios.map((s:any)=>s.profit)))} a {money(Math.max(...result.scenarios.map((s:any)=>s.profit)))}</strong></div></div>
   <div className="cf-table-scroll" tabIndex={0} role="region" aria-label="Cenários condicionais de fechamento"><table><caption>Estimativas, incluindo o realizado de hoje. Cenários ordenados pelo resultado financeiro de referência.</caption><thead><tr><th scope="col">Cenário</th><th scope="col">Gasto</th><th scope="col">Fat. líquido</th><th scope="col">Resultado</th><th scope="col">Pedidos*</th><th scope="col">ROAS</th></tr></thead><tbody>{result.scenarios.map((s:any)=><tr key={s.id} className={s.id==='central'?'cf-row-central':undefined}><th scope="row">{s.label}</th><td>≈ {money(s.spend)}</td><td>≈ {money(s.revenueNet)}</td><td className={s.profit>=0?'cf-positive':'cf-negative'}><span className="cf-signed">{tone(s.profit)&&glyph(tone(s.profit)!)}≈ {money(s.profit)}</span></td><td>≈ {number(s.orders)}</td><td>{number(s.roas,2)}x</td></tr>)}</tbody></table></div>
   <small className="cf-footnote">* Pedidos incluem upsells. Não é uma previsão de vendas front ou compradores.</small>
   <details className="cf-details"><summary><Info size={13} aria-hidden="true"/> Entender a projeção<ChevronDown size={13} className="cf-chevron" aria-hidden="true"/></summary><p>Usa {result.historyDays} dias fechados com gasto. O ritmo parcial estima o gasto restante; a eficiência combina o parcial atual ({number(result.weightToday!*100)}% do peso) com dias históricos de resultado menor, mediano e maior.</p><p>Inclui o realizado até a coleta de {stamp(result.observedAt)}. Horizonte: {stamp(result.closesAt)} · {tz}. Não supõe que aumentar o orçamento produzirá o mesmo retorno.</p><ul>{result.warnings.map((w:string)=><li key={w}>{w}</li>)}</ul></details>
  </>}
  <footer>A projeção é apoio à leitura. Não modifica recomendações, aprovações ou orçamento.</footer>
 </section>;
}
