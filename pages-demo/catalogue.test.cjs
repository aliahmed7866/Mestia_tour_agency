const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const M=require('./model.js');

const seed=[
  {id:1,title_en:'Summer walk',description_en:'An easy summer walk.',kind:'tour',published:true,season_months:'6, 7,8',difficulty:'Easy',price:120},
  {id:2,title_en:'Winter hike',description_en:'A winter hike.',kind:'tour',published:true,season_months:'1,2',difficulty:'Hard',price:120},
  {id:3,title_en:'Guesthouse',description_en:'A sample stay.',kind:'stay',published:true,season_months:'1,7',price:90},
  {id:4,title_en:'Hidden tour',description_en:'Not published.',kind:'tour',published:false,season_months:'7',difficulty:'Easy',price:120},
];

function browser(hash){
  const main={innerHTML:'',focus(){}},notice={textContent:''};
  const events={},windowEvents={};
  const context={
    window:{DemoModel:M,DEMO_SEED:seed,addEventListener:(type,fn)=>windowEvents[type]=fn,scrollTo(){}},
    document:{querySelector:selector=>selector==='#main'?main:notice,addEventListener:(type,fn)=>events[type]=fn},
    location:{hash},localStorage:{getItem:()=>null,setItem(){}},URLSearchParams,
    FormData:class {constructor(form){return Object.entries(form.values)}},
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(require.resolve('./demo.js'),'utf8'),context);
  return {main,context,navigate(hash){context.location.hash=hash;windowEvents.hashchange()},submit(values){events.submit({target:{dataset:{form:'filter'},values},preventDefault(){}})}};
}

test('filtered deep links restore category, month, effort and result count',()=>{
  const b=browser('#catalogue/tour?month=7&effort=Easy');
  assert.match(b.main.innerHTML,/<option value="7" selected>July/);
  assert.match(b.main.innerHTML,/<option value="Easy" selected>Easy/);
  assert.match(b.main.innerHTML,/1 activity matches your filters/);
  assert.match(b.main.innerHTML,/href="#catalogue\/tour" aria-current="page"/);
  assert.match(b.main.innerHTML,/Summer walk/);
  assert.doesNotMatch(b.main.innerHTML,/Winter hike|href="#trip\/3"|Hidden tour/);
});

test('filter submit records a navigable URL and repeated submit remains stable',()=>{
  const b=browser('#catalogue/tour');
  b.submit({kind:'tour',month:'7',effort:'Easy'});
  assert.equal(b.context.location.hash,'catalogue/tour?month=7&effort=Easy');
  b.navigate('#'+b.context.location.hash);
  const before=b.main.innerHTML;
  b.submit({kind:'tour',month:'7',effort:'Easy'});
  assert.equal(b.main.innerHTML,before);
});

test('trip navigation then Back restores filtered results; clearing preserves category',()=>{
  const b=browser('#catalogue/tour?month=7&effort=Easy');
  const before=b.main.innerHTML;
  b.navigate('#trip/1');
  b.navigate('#catalogue/tour?month=7&effort=Easy');
  assert.equal(b.main.innerHTML,before);
  b.navigate('#catalogue/tour');
  assert.match(b.main.innerHTML,/2 activities/);
  assert.match(b.main.innerHTML,/Summer walk/);
  assert.match(b.main.innerHTML,/Winter hike/);
});

test('empty results include an actionable category-preserving reset',()=>{
  const b=browser('#catalogue/tour?month=12');
  assert.match(b.main.innerHTML,/0 activities match your filters/);
  assert.match(b.main.innerHTML,/No activities match these filters/);
  assert.match(b.main.innerHTML,/href="#catalogue\/tour">Clear filters/);
});

test('missing seasons do not crash filtering and URL values are escaped',()=>{
  const b=browser('#catalogue/tour?month=7&effort=%22%3E%3Cscript%3E');
  assert.match(b.main.innerHTML,/&quot;&gt;&lt;script&gt;/);
  assert.doesNotMatch(b.main.innerHTML,/<script>/);
  b.context.window.DEMO_SEED[0].season_months=undefined;
  const fresh=browser('#catalogue/tour?month=7');
  assert.match(fresh.main.innerHTML,/0 activities/);
  seed[0].season_months='6, 7,8';
});
