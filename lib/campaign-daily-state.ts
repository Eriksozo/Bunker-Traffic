import {storage} from './storage';
import {readState} from './state';
import {dailyDataAction} from './campaign-daily-data.mjs';
import hosting from '../.openai/hosting.json';

/** The visual daily series has its own records and cannot change analysis seals. */
export async function updateDailyState(input:Record<string,unknown>,state?:unknown){
 const configured=state??(await readState()).state;
 return {...await dailyDataAction(storage(),configured,input),siteProjectId:hosting.project_id};
}
