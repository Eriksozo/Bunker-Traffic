/** The "Entregáveis salvos" list in the web (app/report-history.tsx), web only. Pages come from `/api/reports` ordered by
 * createdAt DESC, id DESC (lib/report-archive.mjs); the archive is append-only and the cursor is the last row's
 * (createdAt,id). A new project starts the list again; a refresh of the same project (new central revision) re-reads only
 * the first page and merges it by id, keeping the older pages and the cursor already loaded. The fresh first page is
 * authoritative for its own range: a row in that range that it no longer returns has left the history and is dropped;
 * rows older than that range stay as loaded. Presentation only. */

/** @param {any} row */
const keyOf=row=>[String(row?.createdAt??''),String(row?.id??'')];
/** Sort order of the archive: newer first, then id descending. @param {any} a @param {any} b */
export function reportOrder(a,b){
 const [ca,ia]=keyOf(a),[cb,ib]=keyOf(b);
 return ca===cb?(ia===ib?0:ia<ib?1:-1):ca<cb?1:-1;
}
/** @param {any[]} items */
function unique(items){const seen=new Set();return items.filter(item=>item&&typeof item.id==='string'&&!seen.has(item.id)&&seen.add(item.id));}

/** @returns {{project:string,items:any[],cursor:string|null,added:number}} */
export function reportListEmpty(project=''){return {project:String(project||''),items:[],cursor:null,added:0};}

/**
 * Applies a first-page response. Another project (or an empty list): the page replaces everything. Same project: the
 * page is merged by id, older loaded pages and their cursor are kept, and `added` counts the reports that were not on
 * screen before.
 * @param {ReturnType<typeof reportListEmpty>|null} list @param {string} project @param {{items?:any[],nextCursor?:string|null}} page
 */
export function mergeFirstReportPage(list,project,page){
 const fresh=unique(Array.isArray(page?.items)?page.items:[]).sort(reportOrder),freshCursor=typeof page?.nextCursor==='string'?page.nextCursor:null;
 if(!list||list.project!==project||!list.items.length)return {project,items:fresh,cursor:freshCursor,added:0};
 const known=new Set(list.items.map(item=>item.id)),added=fresh.filter(item=>!known.has(item.id)).length;
 // No further page: the response is the whole history.
 if(freshCursor===null)return {project,items:fresh,cursor:null,added};
 const boundary=fresh.at(-1),freshIds=new Set(fresh.map(item=>item.id));
 const older=boundary?list.items.filter(item=>!freshIds.has(item.id)&&reportOrder(item,boundary)>0):list.items.filter(item=>!freshIds.has(item.id));
 return {project,items:[...fresh,...older],cursor:older.length?list.cursor:freshCursor,added};
}

/** Appends an older page ("Carregar anteriores") without duplicates. @param {ReturnType<typeof reportListEmpty>} list @param {string} project @param {{items?:any[],nextCursor?:string|null}} page */
export function appendReportPage(list,project,page){
 if(!list||list.project!==project)return list;
 const items=unique([...list.items,...(Array.isArray(page?.items)?page.items:[])]).sort(reportOrder);
 return {project,items,cursor:typeof page?.nextCursor==='string'?page.nextCursor:null,added:list.added};
}
