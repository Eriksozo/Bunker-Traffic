import {storage,storageBackend} from './storage';
import {readState} from './state';
import {dailyDataAction} from './campaign-daily-data.mjs';
import hosting from '../.openai/hosting.json';
import {cloudMalvaClient} from './cloud-malva.mjs';
import {requestCloudDaily} from './cloud-daily-results.mjs';

/** The visual daily series has its own records and cannot change analysis seals. */
export async function updateDailyState(input:Record<string,unknown>,state?:unknown){
 if(input.action==='request'&&storageBackend()==='supabase'){
  const db=storage();
  return {...await requestCloudDaily({db,readState:async()=>(await readState()).state,source:cloudMalvaClient(db),target:{projectId:input.projectId,adAccountId:input.adAccountId,objectId:input.objectId}}),siteProjectId:hosting.project_id};
 }
 const configured=state??(await readState()).state;
 return {...await dailyDataAction(storage(),configured,input),siteProjectId:hosting.project_id};
}
