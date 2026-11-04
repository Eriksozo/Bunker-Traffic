import {storage} from './storage';
import {creativeDataAction} from './creative-data.mjs';
import hosting from '../.openai/hosting.json';
export async function updateCreativeState(input:any,state:any){return {...await creativeDataAction(storage(),state,input),siteProjectId:hosting.project_id};}
