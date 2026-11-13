/** The autonomy permission as the dispatch fences check it (docs/autonomy-policy.md). Dependency-free apart from the
 * fingerprint, so the Edge Function's provider fence runs the same check as the Bunker journal (byte-identical copy in
 * supabase/functions/malva-mcp). The owner's configuration and its normalization stay in lib/autonomy-grant.mjs. */
import {fingerprint} from './fingerprint.mjs';
export const autonomyModes=Object.freeze(['off','shadow','confirm','auto']);
export const campaignKey=(adAccountId,objectId)=>`${adAccountId}:${objectId}`;

export function autonomyFingerprint(config){
 if(!config||typeof config!=='object')return null;
 return fingerprint({version:config.version??1,enabled:config.enabled===true,projects:config.projects||{}});
}

/** Mode of one campaign: its own exception, else the project's, else shadow. */
export function effectiveMode(config,project,adAccountId,objectId){
 const p=config?.projects?.[project];if(!p)return 'shadow';
 const c=p.campaigns?.[campaignKey(adAccountId,objectId)];
 return c&&autonomyModes.includes(c.mode)?c.mode:autonomyModes.includes(p.mode)?p.mode:'shadow';
}

export function isAutonomyOrder(p){return p?.autonomyOrder===true&&p.createdBy==='bunk'&&p.roundId===null&&typeof p.grant?.fingerprint==='string'&&!!p.payload?.liveTarget?.id;}

/** Re-checked at claim, prepare and submit (never at confirmation), and again by the provider fence of the Edge Function
 * right before the dispatch receipt: the same permission must still be in force. */
export function assertAutonomyGrant(state,p){
 const config=state?.autonomy;
 if(!config?.enabled)throw Error('Autonomia desligada pelo dono: ordem do Bunk não será enviada.');
 if(autonomyFingerprint(config)!==p.grant.fingerprint)throw Error('Permissões da autonomia mudaram desde a ordem do Bunk: não será enviada.');
 if(effectiveMode(config,p.project,p.payload.adAccountId,p.payload.objectId)!=='auto')throw Error('Campanha fora do modo Automático: ordem do Bunk não será enviada.');
}
