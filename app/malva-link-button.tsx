'use client';
import {useState} from 'react';
import {ExternalLink} from 'lucide-react';
import {malvaCampaignsUrl} from '../lib/malva-link.mjs';

/** Opens the project's campaign list on Malva (no per-campaign URL exists there) and copies the
 * campaign name so it can be pasted straight into Malva's search. Read-only navigation. */
export default function MalvaLinkButton({projectId,name,className=''}:{projectId?:string|null;name?:string|null;className?:string}){
 const url=malvaCampaignsUrl(projectId||'');
 const [copied,setCopied]=useState(false);
 if(!url)return null;
 return <a className={'malva-link '+className} href={url} target="_blank" rel="noopener noreferrer" title="Abre a lista de campanhas do projeto na Malva e copia o nome desta campanha para colar na busca"
  onClick={()=>{if(name&&navigator.clipboard){navigator.clipboard.writeText(name).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),2500);}).catch(()=>{});}}}>
  <ExternalLink size={13} aria-hidden="true"/>{copied?'Nome copiado · cole na busca da Malva':'Abrir na Malva'}
 </a>;
}
