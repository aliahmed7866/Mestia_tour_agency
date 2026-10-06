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
