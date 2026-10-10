import {z} from 'zod';
import {AppError,resourceClaims,zonedInstant} from './domain.ts';
import type {Claim} from './domain.ts';
import type {Resource,TourDeparture} from './types';
export const TOUR_PARALLEL='__tour_parallel__';
export const tourSeatId=(id:string)=>'tour-seat:'+id;
export const scheduleOwner=(id:string)=>'tour-schedule:'+id;
export function parseDeparture(input:unknown){return z.object({id:z.string().uuid(),serviceId:z.string().min(1).max(80),start:zonedInstant,end:zonedInstant,capacity:z.number().int().min(1).max(50),guideId:z.string().min(1).max(80),vehicleId:z.string().max(80).default(''),status:z.enum(['open','closed','cancelled']),version:z.number().int().min(0).default(0)}).refine(d=>Date.parse(d.end)>Date.parse(d.start),{path:['end'],message:'The departure must end after it starts.'}).refine(d=>Date.parse(d.end)-Date.parse(d.start)<=7*86400000,{path:['end'],message:'Schedule tours up to seven days long.'}).parse(input);}
export function simultaneousClaims(start:string,end:string,limit:number):Claim[]{return resourceClaims({id:TOUR_PARALLEL,name:'Simultaneous tours',kind:'departure',capacity:limit,bufferMinutes:0,active:true},start,end,1);}
export function departureScheduleClaims(d:TourDeparture,resources:Resource[],limit:number):Claim[]{
 const guide=resources.find(r=>r.id===d.guideId&&r.kind==='guide'&&r.active);if(!guide)throw new AppError('Choose an active guide for this tour departure.');
 if(Date.parse(d.end)<=Date.parse(d.start))throw new AppError('The departure must end after it starts.');
 if(Date.parse(d.end)-Date.parse(d.start)>7*86400000)throw new AppError('Schedule tours up to seven days long.');
 const claims=[...resourceClaims(guide,d.start,d.end),...simultaneousClaims(d.start,d.end,limit)];
 if(d.vehicleId){const vehicle=resources.find(r=>r.id===d.vehicleId&&r.kind==='vehicle'&&r.active);if(!vehicle)throw new AppError('Choose an active vehicle, or leave vehicle blank.');if(vehicle.capacity<d.capacity)throw new AppError('Tour seats cannot exceed the selected vehicle’s passenger capacity.');claims.push(...resourceClaims(vehicle,d.start,d.end));}
 return claims;
}
export function selectedDeparture(id:string,serviceId:string,start:string,end:string,departures:TourDeparture[],confirmed=false){const d=departures.find(d=>d.id===id&&d.serviceId===serviceId);if(!d)throw new AppError('The selected tour departure no longer matches this service.');if(d.status==='cancelled'||(!confirmed&&d.status!=='open'))throw new AppError('This tour departure is closed. Choose another departure.');if(Date.parse(d.start)!==Date.parse(start)||Date.parse(d.end)!==Date.parse(end))throw new AppError('The departure schedule changed. Review and issue a new quote before confirming.');return d;}
