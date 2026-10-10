import {z} from 'zod';
import {selectedDeparture,simultaneousClaims,tourSeatId} from './tour-domain.ts';
import type {Quote,QuoteItem,Resource,Service,Settings,TravelRequest,TourDeparture} from './types';
export class AppError extends Error {status:number;constructor(message:string,status=400){super(message);this.status=status;}}
export const now=()=>new Date().toISOString();
export const uuid=()=>crypto.randomUUID();
export const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tbilisi',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const text=(max:number)=>z.string().trim().max(max);
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>Number.isFinite(Date.parse(v+'T00:00:00+04:00'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v,'Choose a valid date');
export const requestSchema=z.object({idempotencyKey:z.string().uuid(),name:text(100).min(2),contact:text(150).min(6).refine(v=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)||(/^\+?[\d ().-]{7,35}$/.test(v)&&v.replace(/\D/g,'').length>=7),'Enter an email or phone number with country code'),guests:z.number().int().min(1).max(50),notes:text(2000).default(''),website:text(200).default(''),items:z.array(z.object({serviceId:text(80).min(1),date,endDate:date.optional(),time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),pickup:text(250).optional(),destination:text(250).optional(),luggage:text(250).optional(),departureId:z.string().uuid().optional()})).min(1).max(6)});
export const serviceSchema=z.object({id:text(80).min(1),kind:z.enum(['tour','stay','taxi']),title:text(150).min(2),description:text(2000).min(10),duration:text(150),difficulty:text(100),price:z.number().min(0).max(100000).nullable(),priceBasis:text(100),inclusions:text(2000),season:text(200),maxGuests:z.number().int().min(1).max(50),proposed:z.boolean(),published:z.boolean(),image:text(500)});
export const resourceSchema=z.object({id:text(80).min(1),name:text(150).min(2),kind:z.enum(['room','guide','driver','vehicle','departure']),capacity:z.number().int().min(1).max(50),bufferMinutes:z.number().int().min(0).max(240),active:z.boolean()});
export const settingsSchema=z.object({businessName:text(150).min(2),whatsapp:text(25).refine(v=>!v||/^\d{8,15}$/.test(v),'Use country code and digits only for WhatsApp'),discountPercent:z.number().int().min(0).max(30),discountEnabled:z.boolean(),policy:text(10000).min(30),privacy:text(10000).min(30),operatingHours:text(500),policyVersion:text(100).min(1)});
export const zonedInstant=z.string().regex(/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/).refine(v=>Number.isFinite(Date.parse(v)),'Include a date, time and time zone').refine(v=>{const d=v.slice(0,10);return Number.isFinite(Date.parse(d+'T00:00:00Z'))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;},'Choose a valid calendar date');
export const quoteSchema=z.object({items:z.array(z.object({serviceId:text(80),title:text(150).min(1),amount:z.number().min(0).max(100000),start:zonedInstant,end:zonedInstant,resourceIds:z.array(text(80)).max(20),units:z.number().int().min(1).max(50),departureId:z.string().uuid().optional()})).min(1).max(6),expiresAt:zonedInstant,depositRequired:z.number().min(0).max(100000),terms:text(10000).min(30),policyVersion:text(100).min(1)});
export const money=(n:number)=>Math.round((n+Number.EPSILON)*100)/100;
export function validateItems(input:z.infer<typeof requestSchema>,services:Service[],manual=false){
 if(input.website)throw new AppError('Request could not be submitted.');
 if(new Set(input.items.map(x=>x.serviceId)).size!==input.items.length)throw new AppError('Choose each service once.');
 const kinds:string[]=[];
 for(const item of input.items){const s=services.find(s=>s.id===item.serviceId&&(manual||s.published));if(!s)throw new AppError('One selected service is no longer available. Refresh the catalogue.');kinds.push(s.kind);
  if(item.date<today())throw new AppError('Choose today or a future date in Mestia.');
  if(input.guests>s.maxGuests)throw new AppError(`${s.title}: maximum group size is ${s.maxGuests}.`);
  if(item.departureId&&s.kind!=='tour')throw new AppError('Only tours can use a scheduled departure.');
  if(s.kind==='stay'){if(!item.endDate||item.endDate<=item.date)throw new AppError('Check-out must follow check-in.');if((Date.parse(item.endDate)-Date.parse(item.date))/86400000>30)throw new AppError('For stays over 30 nights, contact the operator.');}
  if(s.kind==='taxi'&&(!item.time||!item.pickup?.trim()||!item.destination?.trim()))throw new AppError('Add a pickup, destination and local time for the taxi.');
 }
 if(kinds.filter(k=>k==='stay').length>1||kinds.filter(k=>k==='taxi').length>1)throw new AppError('Choose one stay and one taxi per request.');
}
export function createQuote(input:z.infer<typeof quoteSchema>,r:TravelRequest,settings:Settings):Quote{
 if(r.status!=='enquiry')throw new AppError('Only an unconfirmed request can be quoted.');
 if(Date.parse(input.expiresAt)<=Date.now()||Date.parse(input.expiresAt)>Date.now()+30*86400000)throw new AppError('Quote expiry must be within the next 30 days.');
 if(input.items.length!==r.items.length||new Set(input.items.map(i=>i.serviceId)).size!==input.items.length||input.items.some(i=>!r.items.find(a=>a.serviceId===i.serviceId)))throw new AppError('Quote every selected service exactly once.');
 for(const q of input.items){if(Date.parse(q.start)>=Date.parse(q.end))throw new AppError('Every service needs an end after its start.');if(Date.parse(q.start)<Date.now())throw new AppError('A service cannot start in the past.');if(Date.parse(q.end)-Date.parse(q.start)>31*86400000)throw new AppError('A service interval cannot exceed 31 days.');}
 const subtotal=money(input.items.reduce((sum,i)=>sum+money(i.amount),0));
 const hasStay=r.serviceSnapshots.some(s=>s.kind==='stay');const tourAmount=input.items.filter(i=>r.serviceSnapshots.find(s=>s.id===i.serviceId)?.kind==='tour').reduce((sum,i)=>sum+money(i.amount),0);
 const discount=settings.discountEnabled&&hasStay?money(tourAmount*settings.discountPercent/100):0;const total=money(subtotal-discount);
 if(input.depositRequired>total)throw new AppError('Required deposit cannot exceed the quote total.');
 return {...input,items:input.items.map(i=>({...i,amount:money(i.amount)})),depositRequired:money(input.depositRequired),id:uuid(),subtotal,discount,total,acceptedAt:null,createdAt:now()};
}
export function assertQuoteLive(r:TravelRequest){if(!r.quote)throw new AppError('Create a quote first.');if(Date.parse(r.quote.expiresAt)<=Date.now())throw new AppError('The quote has expired. Issue a new quote.');if(r.quote.items.some(i=>Date.parse(i.start)<=Date.now()))throw new AppError('A quoted service has already started. Issue a revised future schedule before accepting or confirming.');}
export type Claim={resourceId:string;slot:string;units:number;capacity:number};
export function resourceClaims(resource:Resource,start:string,end:string,units=1):Claim[]{
 if(!resource.active)throw new AppError(`${resource.name} is paused.`);
 let a=Date.parse(start),b=Date.parse(end);if(!Number.isFinite(a)||!Number.isFinite(b)||a>=b)throw new AppError('Invalid resource interval.');
 if(b-a>31*86400000)throw new AppError('Resource intervals cannot exceed 31 days.');
 if(resource.kind==='room'){
  const localDate=(t:number)=>new Date(t+4*3600000).toISOString().slice(0,10);const first=localDate(a),last=localDate(b);
  if(first>=last)throw new AppError('A room needs at least one night.');const out:Claim[]=[];
  for(let d=Date.parse(first+'T00:00:00Z');d<Date.parse(last+'T00:00:00Z');d+=86400000)out.push({resourceId:resource.id,slot:'night:'+new Date(d).toISOString().slice(0,10),units:1,capacity:1});return out;
 }
 a-=resource.bufferMinutes*60000;b+=resource.bufferMinutes*60000;const out:Claim[]=[];const capacity=resource.kind==='departure'?resource.capacity:1;
 const count=resource.kind==='departure'?units:1;if(count>capacity)throw new AppError(`${resource.name} does not have enough capacity.`);
 for(let t=Math.floor(a/900000)*900000;t<b;t+=900000)out.push({resourceId:resource.id,slot:'time:'+t,units:count,capacity});return out;
}
export function quoteClaims(r:TravelRequest,resources:Resource[],departures:TourDeparture[]=[],maxConcurrentTours=1):Claim[]{
 const q=r.quote;if(!q)throw new AppError('No quote.');const claims:Claim[]=[];
 for(const item of q.items){const s=r.serviceSnapshots.find(s=>s.id===item.serviceId);if(!s)throw new AppError('Quoted service is missing.');let assigned=item.resourceIds.map(id=>{const res=resources.find(r=>r.id===id);if(!res)throw new AppError('One resource no longer exists.');return res;});
  if(s.kind==='stay'){const rooms=assigned.filter(r=>r.kind==='room');if(!rooms.length||rooms.reduce((sum,r)=>sum+r.capacity,0)<r.guests)throw new AppError('Assign enough room occupancy for all guests.');}
  if(s.kind==='tour'&&item.departureId){if(item.units!==r.guests)throw new AppError('Tour departure places must match the guest count.');const d=selectedDeparture(item.departureId,item.serviceId,item.start,item.end,departures,r.status==='confirmed');if(r.guests>d.capacity)throw new AppError('This group is larger than the tour departure capacity.');claims.push({resourceId:tourSeatId(d.id),slot:'seats',units:r.guests,capacity:d.capacity});continue;}
  if(s.kind!=='tour'&&item.departureId)throw new AppError('Only tours can use a scheduled departure.');
  if(s.kind==='tour')claims.push(...simultaneousClaims(item.start,item.end,maxConcurrentTours));
  if(s.kind==='tour'&&!assigned.some(r=>r.kind==='guide'))throw new AppError('Assign a guide to every tour.');
  if(s.kind==='taxi'){
   assigned=assigned.filter(res=>res.kind!=='driver'&&res.kind!=='vehicle');
   if(r.dispatch.status!=='accepted'||!r.dispatch.evidence)throw new AppError('A suitable driver must accept the taxi first.');
   for(const [id,kind] of [[r.dispatch.driverId,'driver'],[r.dispatch.vehicleId,'vehicle']]){const res=resources.find(r=>r.id===id&&r.kind===kind&&r.active);if(!res)throw new AppError('Select an active driver and vehicle.');if(kind==='vehicle'&&res.capacity<r.guests)throw new AppError('The vehicle cannot carry all guests.');if(!assigned.find(a=>a.id===id))assigned.push(res);}
  }
  for(const res of assigned){if(res.kind==='vehicle'&&res.capacity<r.guests)throw new AppError(`${res.name} cannot carry all guests.`);if(res.kind==='departure'&&item.units!==r.guests)throw new AppError('Departure seats must equal the guest count.');claims.push(...resourceClaims(res,item.start,item.end,item.units));}
 }
 const keys=new Set<string>();for(const c of claims){const key=c.resourceId+'|'+c.slot;if(keys.has(key))throw new AppError('Two items in this request overlap on the same resource. Adjust their schedule or travel buffer.');keys.add(key);}return claims;
}
export function assertConfirmable(r:TravelRequest){
 if(r.status!=='enquiry')throw new AppError('This request is already closed or confirmed.');assertQuoteLive(r);
 if(r.quote!.items.some(i=>Date.parse(i.start)<=Date.now()))throw new AppError('A service is already in the past. Issue a revised future schedule before confirming.');
 if(!r.quote!.acceptedAt)throw new AppError('The guest must accept this quote first.');
 if(!r.contactVerified)throw new AppError('Record two-way contact verification first.');
 if(r.payment.paid<r.quote!.depositRequired)throw new AppError('Verify the required deposit before confirming.');
}
export function newRequest(input:z.infer<typeof requestSchema>,services:Service[],source:'website'|'manual'='website'):TravelRequest{
 const stamp=now();return {id:uuid(),reference:'MES-'+crypto.randomUUID().slice(0,8).toUpperCase(),token:crypto.randomUUID()+crypto.randomUUID().replaceAll('-',''),tokenExpiresAt:new Date(Date.now()+180*86400000).toISOString(),createdAt:stamp,updatedAt:stamp,name:input.name,contact:input.contact,guests:input.guests,notes:input.notes,items:input.items,serviceSnapshots:input.items.map(i=>structuredClone(services.find(s=>s.id===i.serviceId)!)),status:'enquiry',quote:null,contactVerified:false,payment:{paid:0,entries:[]},dispatch:{status:'unassigned',driverId:'',vehicleId:'',evidence:''},history:[{at:stamp,event:'Request saved; awaiting review',actor:source}],version:0,source};
}
