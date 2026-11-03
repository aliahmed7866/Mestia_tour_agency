import test from 'node:test';
import assert from 'node:assert/strict';
import {compressPhoto} from '../app/lib/compress-photo.ts';
import {MAX_PHOTO_BYTES} from '../app/lib/photos.ts';

test('a large portrait can pass the former input limits and retry at smaller dimensions',async t=>{
  const attempts=[];
  class PhoneImage {
    naturalWidth=9000;
    naturalHeight=12000;
    set src(url){queueMicrotask(()=>this.onload());}
    removeAttribute(){}
  }
  const canvas={
    getContext:()=>({fillRect(){},drawImage(){}}),
    toBlob(callback,type,quality){
      attempts.push([this.width,this.height,quality]);
      callback(new Blob([new Uint8Array(this.height>1200?MAX_PHOTO_BYTES+1:MAX_PHOTO_BYTES)],{type}));
    }
  };
  t.mock.method(URL,'createObjectURL',()=>'blob:test');
  t.mock.method(URL,'revokeObjectURL',()=>{});
  const oldImage=globalThis.Image,oldDocument=globalThis.document;
  globalThis.Image=PhoneImage;
  globalThis.document={createElement:()=>canvas};
  t.after(()=>{globalThis.Image=oldImage;globalThis.document=oldDocument;});
  const blob=await compressPhoto({size:32*1024*1024,type:'image/jpeg'});
  assert.equal(blob.size,MAX_PHOTO_BYTES);
  assert.deepEqual(attempts.map(([w,h])=>[w,h]),[[1200,1600],[1200,1600],[1200,1600],[900,1200]]);
});
