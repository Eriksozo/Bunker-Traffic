import {z} from 'zod';
const label=z.string().max(2500),number=z.number().finite().min(-1e12).max(1e12).nullable().optional();
export function validTimeZone(value){try{new Intl.DateTimeFormat('pt-BR',{timeZone:value});return typeof value==='string'&&!!value;}catch{return false;}}
const instant=label.refine(value=>Number.isFinite(Date.parse(value)),'Data da leitura inválida.');
const row=z.object({id:label.optional(),externalId:label,name:label,level:z.enum(['campaign','adset','ad','account']),adAccountId:label,accountName:label,provider:label.optional(),status:label.optional(),effectiveStatus:label.optional(),accountStatus:z.object({active:z.boolean(),label:label.optional()}).optional(),budgetCurrency:label.optional(),budgetRate:number,dailyBudget:number,lifetimeBudget:number,campaignExternalId:label.nullable().optional(),adsetExternalId:label.nullable().optional(),startAt:label.nullable().optional(),deliveryStartedAt:label.nullable().optional(),spend:number,revenue:number,revenueNet:number,adCosts:number,productCost:number,saleTax:number,frontOrders:number,orders:number,checkouts:number,refundedOrders:number,refundedRevenue:number,impressions:number,linkClicks:number,video3s:number,videoPlays:number});
const snapshot=z.object({projectId:label,projectName:label,period:z.enum(['7d','3d','yesterday','today']),from:instant,to:instant,timezone:label.refine(validTimeZone,'Fuso horário inválido.'),fetchedAt:z.string().datetime(),lastSyncAt:z.string().datetime().nullable(),source:z.literal('Malva MCP'),level:z.enum(['campaign','adset','ad','account']),complete:z.boolean(),coverage:z.object({kind:z.literal('active-spent-tracked'),activeComplete:z.literal(true),spentComplete:z.literal(true),trackedComplete:z.literal(true),trackedCount:z.number().int().nonnegative().max(3000)}).strict().optional(),rows:z.array(row).max(3000)}).refine(s=>Date.parse(s.from)<Date.parse(s.to),'O fim do período deve ser após o início.');
export const bundleSchema=z.object({snapshots:z.array(snapshot).max(40)});
/** Old saved imports remain readable even if they predate boundary validation. */
export function snapshotRange(snapshot){
 if(!snapshot||!validTimeZone(snapshot.timezone)||!Number.isFinite(Date.parse(snapshot.from))||!Number.isFinite(Date.parse(snapshot.to))||Date.parse(snapshot.from)>=Date.parse(snapshot.to))return 'Período ou fuso inválido · N/D';
 const format=new Intl.DateTimeFormat('pt-BR',{timeZone:snapshot.timezone,dateStyle:'short'});
 return `${format.format(new Date(snapshot.from))} — ${format.format(new Date(Date.parse(snapshot.to)-1))} · ${snapshot.timezone}`;
}
