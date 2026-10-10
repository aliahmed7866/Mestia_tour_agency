export type ServiceKind = 'tour' | 'stay' | 'taxi';
export type Service = { id:string; kind:ServiceKind; title:string; description:string; duration:string; difficulty:string; price:number|null; priceBasis:string; inclusions:string; season:string; maxGuests:number; proposed:boolean; published:boolean; image:string };
export type Settings = { businessName:string; whatsapp:string; discountPercent:number; discountEnabled:boolean; policy:string; privacy:string; operatingHours:string; adminUserId?:string; policyVersion:string; maxConcurrentTours?:number };
export type Resource = {id:string; name:string; kind:'room'|'guide'|'driver'|'vehicle'|'departure'; capacity:number; bufferMinutes:number; active:boolean};
export type RequestItem = {serviceId:string; date:string; endDate?:string; time?:string; pickup?:string; destination?:string; luggage?:string;departureId?:string};
export type QuoteItem = {serviceId:string; title:string; amount:number; start:string; end:string; resourceIds:string[]; units:number;departureId?:string};
export type Quote = {id:string; items:QuoteItem[]; expiresAt:string; depositRequired:number; terms:string; policyVersion:string; subtotal:number; discount:number; total:number; acceptedAt:string|null; createdAt:string};
export type Payment = {paid:number; entries:{id:string;amount:number;reference:string;at:string}[]};
export type Dispatch = {status:'unassigned'|'offered'|'accepted'|'unavailable'; driverId:string; vehicleId:string; evidence:string; acceptedAt?:string; offerExpiresAt?:string};
export type TravelRequest = { id:string; reference:string; token:string; tokenExpiresAt:string; createdAt:string; updatedAt:string; name:string; contact:string; guests:number; notes:string; items:RequestItem[]; serviceSnapshots:Service[]; status:'enquiry'|'confirmed'|'cancelled'|'completed'; quote:Quote|null; contactVerified:boolean; contactEvidence?:string; payment:Payment; dispatch:Dispatch; history:{at:string;event:string;actor:string}[]; version:number; source:'website'|'manual' };
export type AvailabilityBlock = {id:string;resourceId:string;start:string;end:string;reason:string};
export type AdminData = { initialized:boolean; identity:string; settings:Settings; services:Service[]; resources:Resource[]; requests:TravelRequest[]; blocks:AvailabilityBlock[]; departures:TourDeparture[]; tourInventory:{maxConcurrentTours:number} };

export type TourDeparture = {id:string;serviceId:string;start:string;end:string;capacity:number;guideId:string;vehicleId:string;status:'open'|'closed'|'cancelled';version:number;bookedSeats?:number;remainingSeats?:number;requestedSeats?:number};
export type PublicDeparture = Pick<TourDeparture,'id'|'serviceId'|'start'|'end'|'capacity'|'status'|'bookedSeats'|'remainingSeats'>;
