'use client';
import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';

const fields=[['targetRoas','ROAS-alvo'],['dailyCap','Teto diário autorizado (R$)'],['lossCap','Limite de perda da rodada (R$)'],['testHours','Proteção mínima dos testes (horas)'],['cpcMax','CPC de referência (R$)'],['cpmMax','CPM de referência (R$)'],['icMax','Custo por IC de referência (R$)']] as const;
type Field=typeof fields[number][0];
type Values=Record<Field,string>;
type Config={projectName:string}&Partial<Record<Field,number|null>>;
type Props={project:string;config:Config;save:(input:{op:'config';project:string;config:Config})=>Promise<boolean>;saving:boolean};

export default function ConfigPanel({project,config,save,saving}:Props){
 const savedValues=Object.fromEntries(fields.map(([key])=>[key,config[key]===null||config[key]===undefined?'':String(config[key])])) as Values;
 const savedKey=JSON.stringify({project,projectName:config.projectName,...savedValues});
 const [draft,setDraft]=useState<{baseKey:string;values:Values}|null>(null);
 const values=draft?.values||savedValues,conflict=!!draft&&draft.baseKey!==savedKey;
 function change(key:Field,value:string){setDraft(previous=>({baseKey:previous?.baseKey||savedKey,values:{...(previous?.values||savedValues),[key]:value}}));}
 return <form className="config-form" onSubmit={async event=>{
  event.preventDefault();if(saving||conflict)return;
  const next={projectName:config.projectName,...Object.fromEntries(fields.map(([key])=>[key,values[key]===''?null:Number(values[key])]))} as Config;
  if(await save({op:'config',project,config:next}))setDraft(null);
 }}>
  {conflict&&<div className="notice" role="status"><div><strong>Os parâmetros salvos mudaram em outra sessão.</strong><p>Seu rascunho foi preservado. Carregue os valores salvos antes de editar e salvar novamente.</p><Button type="button" className="button" disabled={saving} onClick={()=>setDraft(null)}>Usar parâmetros salvos</Button></div></div>}
  {fields.map(([key,label])=><label key={key}>{label}<Input type="number" min="0" step="0.01" name={key} value={values[key]} onChange={event=>change(key,event.target.value)} disabled={saving} placeholder="Não informado"/></label>)}
  <Button type="submit" className="button primary" disabled={saving||conflict}>Salvar parâmetros internos</Button>
 </form>;
}
