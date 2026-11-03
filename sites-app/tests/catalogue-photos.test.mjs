import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {existsSync} from 'node:fs';
registerHooks({resolve(specifier,context,next){if(specifier.startsWith('.')&&context.parentURL?.endsWith('.ts')&&!specifier.endsWith('.ts')){const url=new URL(specifier+'.ts',context.parentURL);if(existsSync(url))return{url:url.href,shortCircuit:true};}return next(specifier,context);}});
const {enrichService}=await import('../app/lib/catalogue-content.ts');
const {PROPOSED_SERVICES}=await import('../app/lib/defaults.ts');
const {serviceSchema}=await import('../app/lib/domain.ts');
const {servicePhotos,validatePhoto}=await import('../app/lib/photos.ts');
const {jpeg}=await import('./photo-fixture.mjs');
test('enrichment upgrades seed copy but preserves owner edits and empty highlights',()=>{
 const original=PROPOSED_SERVICES[0],enhanced=enrichService(original);assert.notEqual(enhanced.description,original.description);assert.ok(enhanced.highlights.length);
 const custom={...original,description:'Our own confirmed route description.',highlights:[],price:200};assert.deepEqual(enrichService(custom),custom);assert.equal(enrichService(enhanced).description,enhanced.description);
});
test('gallery validation preserves legacy covers and rejects executable URLs and excess photos',()=>{
 const base=PROPOSED_SERVICES[0];assert.equal(servicePhotos({...base,image:'https://example.test/image.jpg'}).length,1);
 assert.equal(servicePhotos({...base,image:'javascript:alert(1)'}).length,0);
 assert.throws(()=>serviceSchema.parse({...base,photos:[{url:'javascript:alert(1)',alt:''}]}));
 assert.throws(()=>serviceSchema.parse({...base,photos:Array.from({length:13},()=>({url:'/api/media/photo',alt:''}))}));
 assert.doesNotThrow(()=>validatePhoto(jpeg));assert.throws(()=>validatePhoto(new Uint8Array([255,216,255,217])));
});
