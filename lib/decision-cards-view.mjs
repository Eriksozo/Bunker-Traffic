/** View state of the Cards hub (search, tab, filters and the history's own search), web only. The view belongs to one
 * project identity and one entry point (deep link): when either changes, the view starts again from the entry point
 * instead of carrying another project's search or tab. Purely visual preferences (the list/board layout) live outside
 * this view and are never reset by it.
 * Presentation only: nothing here touches decisions, proposals or the approval freeze. */
export const cardsTabs=/** @type {const} */(['cards','history','learning']);

/** @param {any} value @returns {'cards'|'history'|'learning'} */
export function cardsTab(value){return cardsTabs.includes(value)?value:'cards';}

/** Identity of the context the view belongs to: the project plus the entry point that opened it.
 * @param {any} project @param {any} [initialSearch] @param {any} [initialTab] */
export function cardsViewKey(project,initialSearch='',initialTab='cards'){
 return JSON.stringify([String(project??''),String(initialSearch??''),cardsTab(initialTab)]);
}

/**
 * The view for the current context. Same context: the previous view as it is (the owner's own search and filters stay).
 * New project or new entry point: search, tab, filters and the history search restart from the entry point.
 * @param {any} previous @param {{project:any,initialSearch?:any,initialTab?:any}} context
 * @returns {{key:string,tab:'cards'|'history'|'learning',search:string,actionFilter:string,statusFilter:string,historyQuery:string}}
 */
export function cardsViewFor(previous,{project,initialSearch='',initialTab='cards'}){
 const key=cardsViewKey(project,initialSearch,initialTab);
 if(previous&&previous.key===key)return previous;
 const search=String(initialSearch??'');
 return {key,tab:cardsTab(initialTab),search,actionFilter:'all',statusFilter:'all',historyQuery:search};
}
