/** Link to a project's campaign list in the Malva dashboard (it has no per-campaign URL).
 * Same view as the owner uses: traffic sales, today, campaign level, all statuses. Never adds tokens or filters. */
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function malvaCampaignsUrl(projectId,{preset='today'}={}){
 if(typeof projectId!=='string'||!uuid.test(projectId))return null;
 const params=new URLSearchParams({sales:'traffic',preset:['today','yesterday','7d','3d'].includes(preset)?preset:'today',level:'campaign',status:'all'});
 return `https://malvadash.com/tracking/${projectId.toLowerCase()}/campanhas?${params}`;
}
