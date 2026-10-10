/* Browser-only teaching model. Sample data is never a real booking authority. */
(function(root){
'use strict';
const clone=x=>JSON.parse(JSON.stringify(x));
const day=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tbilisi',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const stamp=value=>typeof value==='string'?Date.parse(value.length===10?value+'T00:00:00+04:00':value):NaN;
const overlap=(a,b)=>stamp(a.start)<stamp(b.end)&&stamp(b.start)<stamp(a.end);
const assert=(ok,message)=>{if(!ok)throw Error(message)};
const booked=r=>['confirmed','completed','no_show'].includes(r.booking);
const held=r=>r.quote&&(booked(r)||['offered','accepted'].includes(r.quote.status));
function upgrade(s){s.version=2;s.departures=s.departures||[];if(!s.settings.maxConcurrentTours)s.settings.maxConcurrentTours=Math.max(1,peak(tourSchedules(s)));for(const r of s.resources)r.capacity=r.capacity||1;return s}
function fresh(seed){return upgrade({services:clone(seed),requests:[],resources:[{id:1,name:'Guide · sample',kind:'guide',capacity:1,active:true},{id:2,name:'Room 1 · sample',kind:'room',capacity:2,active:true},{id:3,name:'Driver & vehicle · sample',kind:'driver',capacity:4,active:true}],blocks:[],providers:[{id:1,name:'Local host · sample',approved:true}],settings:{name:'Mestia',discount:10,offer:true,terms:'Demo terms: route and price agreed before confirmation. Contact the host for changes.'},reminders:[],history:[]})}
function log(s,text){s.history.unshift({at:new Date().toISOString(),text})}
function expire(s){for(const r of s.requests)if(r.quote&&['offered','accepted'].includes(r.quote.status)&&Date.parse(r.quote.expires)<=Date.now()){r.quote.status='expired';log(s,r.id+' quote expired')}}
function departure(s,id){return s.departures.find(d=>d.id===+id)}
function seats(s,d){
  const matching=s.requests.filter(r=>r.departure===d.id);
  const confirmed=matching.filter(booked).reduce((n,r)=>n+r.guests,0);
  const requested=matching.filter(r=>!r.booking&&r.status!=='closed'&&r.quote?.status!=='cancelled').reduce((n,r)=>n+r.guests,0);
  return {confirmed,remaining:d.capacity-confirmed,requested};
}
function legacyTours(s,skipRequest){
  expire(s);
  return s.requests.filter(r=>r.id!==skipRequest&&held(r)).flatMap(r=>r.quote.items.filter(i=>i.kind==='tour'&&!i.departure));
}
function peak(intervals){
  const events=intervals.flatMap(i=>[{at:stamp(i.start),change:1},{at:stamp(i.end),change:-1}]).sort((a,b)=>a.at-b.at||a.change-b.change);
  let current=0,maximum=0;for(const e of events){current+=e.change;maximum=Math.max(maximum,current)}return maximum;
}
function tourSchedules(s,skipDeparture,skipRequest){return [...s.departures.filter(d=>d.id!==skipDeparture&&d.status!=='cancelled'),...legacyTours(s,skipRequest)].filter(i=>stamp(i.end)>Date.now())}
function setTourLimit(s,value){
  const limit=+value;assert(Number.isInteger(limit)&&limit>=1&&limit<=20,'Choose 1–20 simultaneous tours.');
  assert(peak(tourSchedules(s))<=limit,'Existing tours overlap above this limit. Reschedule or cancel an unused departure first.');
  s.settings.maxConcurrentTours=limit;log(s,'Simultaneous tour limit set to '+limit);
}
function available(s,r,resource,start,end,departureId=0){
  expire(s);assert(s.resources.some(x=>x.id===+resource&&x.active),'Select an active resource.');
  assert(!s.blocks.some(b=>b.resource===+resource&&overlap({start,end},b)),'Resource is blocked for those dates.');
  for(const d of s.departures)if(d.status!=='cancelled'&&d.id!==+departureId&&[d.guide,d.vehicle].includes(+resource))assert(!overlap({start,end},d),'Resource is assigned to another scheduled departure.');
  for(const other of s.requests){if(other.id===r.id||!held(other))continue;assert(!other.quote.items.some(i=>i.resource===+resource&&!(departureId&&i.departure===+departureId)&&overlap({start,end},i)),'Resource already held or booked.')}
}
function saveDeparture(s,data){
  const previous=departure(s,data.id),d={id:previous?.id||Math.max(0,...s.departures.map(x=>x.id))+1,service:+data.service,start:data.start,end:data.end,capacity:+data.capacity,guide:+data.guide,vehicle:+data.vehicle||0,status:data.status||'open'};
  const service=s.services.find(x=>x.id===d.service);
  assert(service&&service.kind==='tour'&&!service.archived,'Choose a tour from Catalogue.');
  assert(Number.isFinite(stamp(d.start))&&Number.isFinite(stamp(d.end))&&stamp(d.end)>stamp(d.start),'The finish must follow the departure start.');
  assert(['open','closed','cancelled'].includes(d.status),'Choose a valid departure status.');
  const confirmed=previous?seats(s,previous).confirmed:0;
  assert(Number.isInteger(d.capacity)&&d.capacity>=Math.max(1,confirmed)&&d.capacity<=50,'Choose 1–50 places, keeping all confirmed guests’ places.');
  if(confirmed){assert(['service','start','end','guide','vehicle'].every(k=>d[k]===previous[k]),'Confirmed departures keep their tour, schedule, guide and vehicle.');assert(d.status!=='cancelled','Cancel the affected bookings before cancelling this departure.')}
  const guide=s.resources.find(x=>x.id===d.guide&&x.kind==='guide');
  const vehicle=s.resources.find(x=>x.id===d.vehicle&&x.kind==='vehicle');
  assert(guide&&(guide.active||confirmed||d.status==='cancelled'),'Choose an active guide. Add one in Resources if needed.');
  if(d.vehicle)assert(vehicle&&(vehicle.active||confirmed||d.status==='cancelled')&&d.capacity<=vehicle.capacity,'Places cannot exceed the selected vehicle’s passenger capacity.');
  if(d.status!=='cancelled'){
    if(!confirmed)assert(stamp(d.start)>Date.now(),'Choose an upcoming departure time.');
    available(s,{id:null},d.guide,d.start,d.end,d.id);if(d.vehicle)available(s,{id:null},d.vehicle,d.start,d.end,d.id);
    assert(peak([...tourSchedules(s,d.id),d])<=s.settings.maxConcurrentTours,'Too many tours run at the same time. Increase the limit or choose another time.');
  }
  if(previous)Object.assign(previous,d);else s.departures.push(d);
  log(s,'Departure '+d.id+' saved ('+d.status+')');return previous||d;
}
function request(s,data){
  const svc=s.services.find(x=>x.id===Number(data.service));assert(svc&&svc.published&&!svc.archived,'Choose a published activity.');
  assert(String(data.name||'').trim()&&String(data.contact||'').trim(),'Add fictional name and contact details.');
  assert(data.start>=day()&&data.end>data.start,'Choose valid future dates; end must follow start.');
  assert(Number.isInteger(+data.guests)&&+data.guests>0&&+data.guests<=100,'Choose 1–100 guests.');
  const dep=data.departure?departure(s,data.departure):null;
  if(data.departure){assert(dep&&svc.kind==='tour'&&dep.service===svc.id,'Choose a departure for this tour.');assert(dep.status==='open'&&stamp(dep.start)>Date.now(),'This departure is closed or unavailable. Choose another date.');assert(dep.start.slice(0,10)===data.start,'The requested date must match the selected departure.');assert(+data.guests<=seats(s,dep).remaining,'Not enough places remain for this group.')}
  else if(svc.kind==='tour'&&s.departures.some(d=>d.service===svc.id&&d.start.slice(0,10)===data.start))assert(false,'Choose an open scheduled departure for this date.');
  if(data.stay){assert(s.settings.offer&&svc.kind==='tour','This offer is not available.');assert(data.checkin<=data.start&&data.checkout>=data.start&&data.checkout>data.checkin,'Tour date must fall within your stay.');assert(s.services.some(x=>x.kind==='stay'&&x.published&&!x.archived),'No demo stay is published.')}
  const r={id:'DEMO-'+String(s.requests.length+1).padStart(4,'0'),...data,departure:dep?.id||0,service:svc.id,title:svc.title_en,kind:svc.kind,guests:+data.guests,contactVerified:false,status:'new',quote:null,booking:null,payments:[],messages:[],driver:'unassigned',offer:data.stay?{percent:+s.settings.discount,checkin:data.checkin,checkout:data.checkout}:null};
  s.requests.unshift(r);log(s,r.id+' requested');return r;
}
function checkSeats(s,r,i){
  const d=departure(s,i.departure);assert(d&&i.kind==='tour'&&d.service===r.service&&r.departure===d.id,'Use the departure selected in this guest request.');
  assert(d.status==='open','The departure is closed or cancelled. Reopen it before quoting or confirming.');
  assert(stamp(d.start)>Date.now(),'This departure has already started. Arrange a new date with the guest.');
  assert(i.start===d.start&&i.end===d.end&&+i.resource===d.guide,'The quote must use the departure’s saved schedule and guide.');
  assert(r.guests<=seats(s,d).remaining,'Not enough places remain. Another booking has used these seats.');return d;
}
function quote(s,r,items,deposit,hours,applyOffer){
  assert(!booked(r),'Cancel the confirmed booking before replacing its quote.');assert(!r.payments.length,'This quote has payment records. Keep them and start a new request for a different quote.');assert(items.length&&hours>=1&&hours<=168,'Choose items and an expiry between 1 and 168 hours.');
  const copy=clone(items);for(const i of copy){assert(i.title.trim()&&Number.isFinite(i.price)&&i.price>=0&&Number.isInteger(i.quantity)&&i.quantity>0,'Enter item title, explicit price and quantity.');assert(i.start>=day()&&stamp(i.end)>stamp(i.start),'Agree valid item dates.');
    if(i.departure){const d=checkSeats(s,r,i);available(s,r,i.resource,i.start,i.end,d.id);if(d.vehicle)available(s,r,d.vehicle,i.start,i.end,d.id)}
    else{assert(!(r.departure&&i.kind==='tour'),'Use the guest’s scheduled departure for the tour quote.');available(s,r,i.resource,i.start,i.end)}
    i.original=i.price;i.total=Math.round(i.price*100)*i.quantity;
  }
  for(let a=0;a<copy.length;a++)for(let b=a+1;b<copy.length;b++){assert(!copy[a].departure||copy[a].departure!==copy[b].departure,'Include this tour departure only once in the quote.');assert(copy[a].resource!==copy[b].resource||!overlap(copy[a],copy[b]),'Two items cannot use the same resource at overlapping times.')}
  assert(peak([...tourSchedules(s,0,r.id),...copy.filter(i=>i.kind==='tour'&&!i.departure)])<=s.settings.maxConcurrentTours,'Too many tours run at the same time. Choose another time or adjust Inventory.');
  if(applyOffer){assert(r.offer&&copy.some(i=>i.kind==='stay'&&i.start<=r.start&&i.end>=r.start),'Include a stay covering the tour to apply the offer.');for(const i of copy)if(i.kind==='tour'){i.price=Math.round(i.price*100*(100-r.offer.percent)/100)/100;i.total=Math.round(i.price*100)*i.quantity}}
  const total=copy.reduce((n,i)=>n+i.total,0);assert(Number.isFinite(deposit)&&deposit>=0&&Math.round(deposit*100)<=total,'Deposit must be between zero and the total.');
  r.quote={version:(r.quote?.version||0)+1,status:'offered',items:copy,total,deposit:Math.round(deposit*100),expires:new Date(Date.now()+hours*3600000).toISOString(),terms:s.settings.terms,discount:applyOffer?r.offer.percent:0};r.payments=[];r.driver='unassigned';r.status='reviewed';r.booking=null;log(s,r.id+' quote prepared');
}
function paid(r){return r.payments.filter(p=>p.verified).reduce((n,p)=>n+(p.kind==='refund'?-p.amount:p.amount),0)}
function accept(s,r){expire(s);assert(r.quote?.status==='offered','No current offer to accept.');for(const i of r.quote.items)if(i.departure)checkSeats(s,r,i);r.quote.status='accepted';log(s,r.id+' guest accepted')}
function confirm(s,r){
  expire(s);assert(r.quote?.status==='accepted','Guest must accept the current quote first.');assert(r.contactVerified,'Verify a two-way contact first.');assert(paid(r)>=r.quote.deposit,'Verify the required deposit first.');if(r.quote.items.some(i=>i.kind==='taxi'))assert(r.driver==='accepted','Driver must accept first.');
  for(const i of r.quote.items){if(i.departure){const d=checkSeats(s,r,i);available(s,r,i.resource,i.start,i.end,d.id);if(d.vehicle)available(s,r,d.vehicle,i.start,i.end,d.id)}else available(s,r,i.resource,i.start,i.end)}
  assert(peak(tourSchedules(s))<=s.settings.maxConcurrentTours,'Too many tours run at the same time. Review Inventory first.');
  r.booking='confirmed';r.quote.status='confirmed';log(s,r.id+' booking confirmed');
}
function cancel(s,r){if(r.quote)r.quote.status='cancelled';r.booking='cancelled';r.driver='cancelled';log(s,r.id+' cancelled; resources released')}
root.DemoModel={fresh,upgrade,request,quote,accept,confirm,cancel,available,paid,expire,day,log,departure,seats,saveDeparture,setTourLimit,peak};
if(typeof module!=='undefined')module.exports=root.DemoModel;
})(typeof window==='undefined'?globalThis:window);
