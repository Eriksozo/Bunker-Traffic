'use client';
import {useId,useState} from 'react';
import './accounts-panel.css';

const fields=[['targetRoas','ROAS-alvo'],['dailyCap','Teto diário autorizado (R$)'],['lossCap','Limite de perda da rodada (R$)'],['testHours','Proteção mínima dos testes (horas)'],['cpcMax','CPC de referência (R$)'],['cpmMax','CPM de referência (R$)'],['icMax','Custo por IC de referência (R$)']] as const;
type Field=typeof fields[number][0];
type Values=Record<Field,string>;
type Config={projectName:string}&Partial<Record<Field,number|null>>;
type Props={project:string;config:Config;save:(input:{op:'config';project:string;config:Config})=>Promise<boolean>;saving:boolean};
// Presentation only: grouping and the hint under each field. Every hint restates a rule the Bunker already applies.
const groups:{title:string;keys:Field[]}[]=[{title:'Metas e proteções',keys:['targetRoas','dailyCap','lossCap','testHours']},{title:'Referências de custo',keys:['cpcMax','cpmMax','icMax']}];
const hints:Record<Field,string>={targetRoas:'Meta de retorno do projeto.',dailyCap:'Proteção do Bunker; não é um limite de gasto na Meta.',lossCap:'Proteção do Bunker; não é um limite de gasto na Meta.',testHours:'Vazio fica N/D: nenhuma hora mínima é presumida.',cpcMax:'Referência do projeto; vazio fica N/D.',cpmMax:'Referência do projeto; vazio fica N/D.',icMax:'Referência do projeto; vazio fica N/D.'};
const labels=Object.fromEntries(fields) as Record<Field,string>;

export default function ConfigPanel({project,config,save,saving}:Props){
 const uid=useId();
 const savedValues=Object.fromEntries(fields.map(([key])=>[key,config[key]===null||config[key]===undefined?'':String(config[key])])) as Values;
 const savedKey=JSON.stringify({project,projectName:config.projectName,...savedValues});
 const [draft,setDraft]=useState<{baseKey:string;values:Values}|null>(null);
 const values=draft?.values||savedValues,conflict=!!draft&&draft.baseKey!==savedKey;
 const dirty=!!draft&&!conflict&&fields.some(([key])=>draft.values[key]!==savedValues[key]);
 function change(key:Field,value:string){setDraft(previous=>({baseKey:previous?.baseKey||savedKey,values:{...(previous?.values||savedValues),[key]:value}}));}
 return <form className="config-form cfg-form" onSubmit={async event=>{
  event.preventDefault();if(saving||conflict)return;
  const next={projectName:config.projectName,...Object.fromEntries(fields.map(([key])=>[key,values[key]===''?null:Number(values[key])]))} as Config;
  if(await save({op:'config',project,config:next}))setDraft(null);
 }}>
  {conflict&&<div className="ds-banner ds-banner--warn" role="status"><div className="ds-banner__body"><strong>Os parâmetros salvos mudaram em outra sessão.</strong><p>Seu rascunho foi preservado. Carregue os valores salvos antes de editar e salvar novamente.</p></div><div className="ds-banner__actions"><button type="button" className="ds-btn ds-btn--sm" disabled={saving} onClick={()=>setDraft(null)}>Usar parâmetros salvos</button></div></div>}
  {groups.map((group,g)=><div key={group.title} className="ds-tile cfg-group" role="group" aria-labelledby={`${uid}-g${g}`}>
   <span id={`${uid}-g${g}`} className="ds-eyebrow">{group.title}</span>
   <div className="cfg-grid">{group.keys.map(key=><div key={key} className="ds-form-row cfg-field">
    <label className="ds-label" htmlFor={`${uid}-${key}`}>{labels[key]}</label>
    <input id={`${uid}-${key}`} className="ds-field ds-tabular" type="number" min="0" step="0.01" inputMode="decimal" name={key} value={values[key]} onChange={event=>change(key,event.target.value)} disabled={saving} placeholder="Não informado" aria-describedby={`${uid}-${key}-hint`}/>
    <p id={`${uid}-${key}-hint`} className="ds-hint">{hints[key]}</p>
   </div>)}</div>
  </div>)}
  <div className="cfg-actions">
   <button type="submit" className={'ds-btn '+(dirty?'ds-btn--primary':'ds-btn--secondary')} disabled={saving||conflict} aria-busy={saving||undefined} aria-describedby={conflict?`${uid}-reason`:undefined}>{saving&&<span className="ds-spinner" aria-hidden="true"/>}Salvar parâmetros internos</button>
   {dirty&&!saving&&<span className="ds-caption cfg-dirty"><span className="ds-dot ds-dot--sm ds-dot--accent" aria-hidden="true"/>Alterações ainda não salvas</span>}
   {conflict&&<p id={`${uid}-reason`} className="ds-disabled-reason">Carregue os valores salvos antes de salvar novamente.</p>}
  </div>
 </form>;
}
