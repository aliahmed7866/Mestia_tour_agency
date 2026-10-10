const {test}=require('node:test');
const assert=require('node:assert/strict');
const M=require('./model.js');
const seed=[{id:1,title_en:'Sample tour',kind:'tour',published:true},{id:2,title_en:'Sample stay',kind:'stay',published:true},{id:3,title_en:'Sample taxi',kind:'taxi',published:true}];
const date='2099-07-15',end='2099-07-16';
const data={service:1,name:'Demo',contact:'demo@example.invalid',start:date,end,guests:2};
const item={title:'Mountain day',kind:'tour',price:120,quantity:1,start:date,end,resource:1};
test('complete request, quote, acceptance, deposit and confirmation boundary',()=>{
 const s=M.fresh(seed),r=M.request(s,data);
 assert.equal(r.booking,null);M.quote(s,r,[item],20,24,false);
 assert.throws(()=>M.confirm(s,r),/accept/);M.accept(s,r);
 assert.throws(()=>M.confirm(s,r),/contact/);r.contactVerified=true;
 r.payments.push({kind:'deposit',amount:2000,verified:false});assert.throws(()=>M.confirm(s,r),/deposit/);
 r.payments[0].verified=true;M.confirm(s,r);assert.equal(r.booking,'confirmed');
 const r2=M.request(s,data);assert.throws(()=>M.quote(s,r2,[item],0,24,false),/held/);
 M.cancel(s,r);M.quote(s,r2,[item],0,24,false);assert.equal(r2.quote.total,12000);
});
test('offer snapshot, room excluded, dates and overlap checked',()=>{
 const s=M.fresh(seed),r=M.request(s,{...data,stay:true,checkin:'2099-07-14',checkout:end});
 s.settings.discount=25;
 const room={...item,title:'Room',kind:'stay',resource:2,price:90,start:'2099-07-14',quantity:2};
 M.quote(s,r,[item,room],0,24,true);assert.equal(r.quote.total,28800);assert.equal(r.quote.discount,10);
 assert.throws(()=>M.quote(s,r,[item,{...item}],0,24,false),/overlapping/);
});
test('expiry releases holds; blocks prevent quotes',()=>{
 const s=M.fresh(seed),r=M.request(s,data);M.quote(s,r,[item],0,24,false);
 r.quote.expires='2000-01-01T00:00:00Z';M.expire(s);assert.equal(r.quote.status,'expired');
 assert.throws(()=>M.accept(s,r));const r2=M.request(s,data);M.quote(s,r2,[item],0,24,false);M.cancel(s,r2);
 s.blocks.push({resource:1,start:date,end});assert.throws(()=>M.quote(s,r,[item],0,24,false),/blocked/);
});
test('taxi needs driver acceptance, quotes preserve agreed terms',()=>{
 const s=M.fresh(seed),r=M.request(s,{...data,service:3});M.quote(s,r,[{...item,kind:'taxi',resource:3}],0,24,false);
 const terms=r.quote.terms;s.settings.terms='Changed';assert.equal(r.quote.terms,terms);
 M.accept(s,r);r.contactVerified=true;assert.throws(()=>M.confirm(s,r),/Driver/);r.driver='accepted';M.confirm(s,r);
});
test('unpublished requests and invalid prices are rejected',()=>{
 const s=M.fresh(seed);s.services[0].published=false;assert.throws(()=>M.request(s,data),/published/);
 s.services[0].published=true;const r=M.request(s,data);assert.throws(()=>M.quote(s,r,[{...item,price:NaN}],0,24,false),/price/);
});

const scheduled={service:1,start:'2099-07-15T09:00:00+04:00',end:'2099-07-15T17:00:00+04:00',capacity:5,guide:1,vehicle:0,status:'open'};
const scheduledItem=d=>({...item,start:d.start,end:d.end,resource:d.guide,departure:d.id});
function ready(s,d,guests){const r=M.request(s,{...data,departure:d.id,start:d.start.slice(0,10),end:d.end.slice(0,10)===d.start.slice(0,10)?end:'2099-07-20',guests});M.quote(s,r,[scheduledItem(d)],0,24,false);M.accept(s,r);r.contactVerified=true;return r}
function extraGuide(s,id=4){s.resources.push({id,name:'Another fictional guide',kind:'guide',capacity:1,active:true})}

test('shared departure books separate guest groups and uses one tour slot',()=>{
 const s=M.fresh(seed),d=M.saveDeparture(s,scheduled),a=ready(s,d,2),b=ready(s,d,3);
 assert.deepEqual(M.seats(s,d),{confirmed:0,remaining:5,requested:5});
 M.confirm(s,a);M.confirm(s,b);assert.deepEqual(M.seats(s,d),{confirmed:5,remaining:0,requested:0});
 assert.equal(s.settings.maxConcurrentTours,1);assert.equal(a.quote.items[0].quantity,1);
 assert.throws(()=>M.request(s,{...data,departure:d.id,guests:1}),/places/);
});
test('competing accepted quotes cannot oversell on confirmation',()=>{
 const s=M.fresh(seed),d=M.saveDeparture(s,scheduled),a=ready(s,d,4),b=ready(s,d,4);
 assert.equal(M.seats(s,d).remaining,5);M.confirm(s,a);
 assert.throws(()=>M.confirm(s,b),/places/);assert.equal(b.booking,null);assert.equal(b.quote.status,'accepted');
 assert.equal(M.seats(s,d).confirmed,4);M.cancel(s,a);M.confirm(s,b);assert.equal(M.seats(s,d).confirmed,4);
});
test('cancelling a booking frees seats but keeps its departure schedule',()=>{
 const s=M.fresh(seed),d=M.saveDeparture(s,scheduled),r=ready(s,d,2);M.confirm(s,r);M.cancel(s,r);
 assert.deepEqual(M.seats(s,d),{confirmed:0,remaining:5,requested:0});
 assert.throws(()=>M.saveDeparture(s,{...scheduled,start:'2099-07-15T10:00:00+04:00'}),/scheduled/);
 M.saveDeparture(s,{...d,status:'cancelled'});const replacement=M.saveDeparture(s,scheduled);assert.notEqual(replacement.id,d.id);
});
test('closed departures reject requests, quotes and accepted confirmations until reopened',()=>{
 const s=M.fresh(seed),d=M.saveDeparture(s,scheduled),r=ready(s,d,2);M.saveDeparture(s,{...d,status:'closed'});
 assert.throws(()=>M.request(s,{...data,departure:d.id}),/closed/);
 assert.throws(()=>M.request(s,data),/scheduled/);
 assert.throws(()=>M.quote(s,r,[scheduledItem(d)],0,24,false),/closed/);
 assert.throws(()=>M.confirm(s,r),/closed/);assert.equal(r.quote.status,'accepted');
 M.saveDeparture(s,{...d,status:'open'});M.confirm(s,r);M.saveDeparture(s,{...d,status:'closed'});assert.equal(M.seats(s,d).confirmed,2);
});
test('confirmed schedules stay fixed and capacity never drops below guests',()=>{
 const s=M.fresh(seed),d=M.saveDeparture(s,scheduled),r=ready(s,d,3);M.confirm(s,r);
 for(const change of [{capacity:2},{status:'cancelled'},{start:'2099-07-15T10:00:00+04:00'},{guide:4}])assert.throws(()=>M.saveDeparture(s,{...d,...change}));
 assert.equal(d.capacity,5);assert.equal(d.start,scheduled.start);M.saveDeparture(s,{...d,capacity:3});assert.equal(d.capacity,3);
});
test('requested places do not prevent safe capacity changes',()=>{
 const s=M.fresh(seed),d=M.saveDeparture(s,scheduled),r=ready(s,d,5);M.saveDeparture(s,{...d,capacity:3});
 assert.equal(M.seats(s,d).remaining,3);assert.throws(()=>M.confirm(s,r),/places/);
});
test('global simultaneous limit counts empty and closed departures',()=>{
 const s=M.fresh(seed);extraGuide(s);const d=M.saveDeparture(s,{...scheduled,status:'closed'});
 assert.throws(()=>M.saveDeparture(s,{...scheduled,guide:4}),/same time/);M.setTourLimit(s,2);
 M.saveDeparture(s,{...scheduled,guide:4});assert.throws(()=>M.setTourLimit(s,1),/overlap/);
 assert.throws(()=>M.saveDeparture(s,{...scheduled,start:'2099-07-15T10:00:00+04:00'}),/scheduled/);
 M.setTourLimit(s,10);assert.equal(s.settings.maxConcurrentTours,10);assert.equal(d.status,'closed');
});
test('adjacent departures and peak overlap use interval boundaries correctly',()=>{
 const s=M.fresh(seed);M.saveDeparture(s,{...scheduled,end:'2099-07-15T12:00:00+04:00'});
 M.saveDeparture(s,{...scheduled,start:'2099-07-15T12:00:00+04:00'});assert.equal(s.departures.length,2);
 assert.equal(M.peak([{start:'2099-07-15T09:00:00+04:00',end:'2099-07-15T17:00:00+04:00'},{start:'2099-07-15T09:00:00+04:00',end:'2099-07-15T12:00:00+04:00'},{start:'2099-07-15T13:00:00+04:00',end:'2099-07-15T17:00:00+04:00'}]),2);
});
test('vehicle capacity and exclusive assignments constrain departures',()=>{
 const s=M.fresh(seed);extraGuide(s);M.setTourLimit(s,2);s.resources.push({id:5,name:'Sample vehicle',kind:'vehicle',capacity:4,active:true});
 assert.throws(()=>M.saveDeparture(s,{...scheduled,vehicle:5}),/passenger/);
 const d=M.saveDeparture(s,{...scheduled,capacity:4,vehicle:5});assert.throws(()=>M.saveDeparture(s,{...scheduled,capacity:4,guide:4,vehicle:5}),/scheduled/);
 const r=ready(s,d,2);M.confirm(s,r);assert.equal(M.seats(s,d).remaining,2);
});
test('legacy tour holds conflict with scheduled tours and release on expiry',()=>{
 const s=M.fresh(seed),r=M.request(s,data);M.quote(s,r,[item],0,24,false);
 assert.throws(()=>M.saveDeparture(s,scheduled),/held/);r.quote.expires='2000-01-01T00:00:00Z';M.expire(s);
 M.saveDeparture(s,scheduled);assert.throws(()=>M.quote(s,r,[item],0,24,false),/scheduled/);
});
test('legacy tours also consume the global tour limit with another guide',()=>{
 const s=M.fresh(seed);extraGuide(s);const r=M.request(s,data);M.quote(s,r,[item],0,24,false);
 assert.throws(()=>M.saveDeparture(s,{...scheduled,guide:4}),/same time/);M.cancel(s,r);M.saveDeparture(s,{...scheduled,guide:4});
});
test('quote departure identity and schedule cannot be substituted',()=>{
 const s=M.fresh(seed),d=M.saveDeparture(s,scheduled),r=M.request(s,{...data,departure:d.id});
 assert.throws(()=>M.quote(s,r,[item],0,24,false),/scheduled/);
 assert.throws(()=>M.quote(s,r,[{...scheduledItem(d),start:'2099-07-15T10:00:00+04:00'}],0,24,false),/saved schedule/);
 assert.throws(()=>M.quote(s,r,[scheduledItem(d),scheduledItem(d)],0,24,false),/only once/);
 assert.equal(r.quote,null);
});
test('resource blocks and wrong request dates are checked for departures',()=>{
 const s=M.fresh(seed);s.blocks.push({resource:1,start:date,end});assert.throws(()=>M.saveDeparture(s,scheduled),/blocked/);
 s.blocks=[];const d=M.saveDeparture(s,scheduled);assert.throws(()=>M.request(s,{...data,departure:d.id,start:'2099-07-16',end:'2099-07-17'}),/match/);
});
test('paid quotes cannot be replaced through direct model calls',()=>{
 const s=M.fresh(seed),r=M.request(s,data);M.quote(s,r,[item],0,24,false);const original=r.quote;r.payments.push({amount:2000,kind:'deposit',verified:true});
 assert.throws(()=>M.quote(s,r,[item],0,24,false),/payment records/);assert.equal(r.quote,original);assert.equal(M.paid(r),2000);
});
test('version 1 migration preserves requests and existing concurrent commitments',()=>{
 const s=M.fresh(seed);extraGuide(s);M.setTourLimit(s,2);const a=M.request(s,data),b=M.request(s,data);M.quote(s,a,[item],0,24,false);M.quote(s,b,[{...item,resource:4}],0,24,false);
 s.version=1;delete s.departures;delete s.settings.maxConcurrentTours;M.upgrade(s);
 assert.equal(s.version,2);assert.equal(s.requests.length,2);assert.equal(s.settings.maxConcurrentTours,2);assert.equal(a.quote.status,'offered');assert.deepEqual(s.departures,[]);
});
test('historical tour overlap does not block future limits or schedules',()=>{
 const s=M.fresh(seed);extraGuide(s);s.settings.maxConcurrentTours=2;
 s.departures=[{...scheduled,id:1,start:'2000-07-15T09:00:00+04:00',end:'2000-07-15T17:00:00+04:00'},{...scheduled,id:2,guide:4,start:'2000-07-15T09:00:00+04:00',end:'2000-07-15T17:00:00+04:00'}];
 s.requests.push({id:'OLD',departure:1,guests:3,booking:'completed',quote:null});
 M.setTourLimit(s,1);assert.equal(M.seats(s,s.departures[0]).confirmed,3);M.saveDeparture(s,scheduled);
 const legacy={...item,start:'2000-07-15',end:'2000-07-16'};s.requests.push({id:'OLD-PRIVATE',guests:2,booking:'completed',quote:{status:'completed',items:[legacy]}});
 M.setTourLimit(s,1);delete s.settings.maxConcurrentTours;M.upgrade(s);assert.equal(s.settings.maxConcurrentTours,1);
});
test('guest acceptance checks closed, rescheduled, full and started departures',()=>{
 for(const change of ['closed','moved','full','started']){
  const s=M.fresh(seed),d=M.saveDeparture(s,scheduled),r=M.request(s,{...data,departure:d.id});M.quote(s,r,[scheduledItem(d)],0,24,false);
  if(change==='closed')M.saveDeparture(s,{...d,status:'closed'});
  if(change==='moved')M.saveDeparture(s,{...d,start:'2099-07-15T10:00:00+04:00'});
  if(change==='full'){const other=ready(s,d,5);M.confirm(s,other)}
  if(change==='started'){d.start='2000-07-15T09:00:00+04:00';d.end='2000-07-15T17:00:00+04:00'}
  assert.throws(()=>M.accept(s,r));assert.equal(r.quote.status,'offered');
 }
});

