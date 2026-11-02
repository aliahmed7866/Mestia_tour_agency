import test from 'node:test';
import assert from 'node:assert/strict';
import {translate,georgian} from '../app/lib/georgian.ts';
test('Georgian covers booking decisions and retains original unknown content',()=>{
  for(const key of ['Number of guests','Your name','Phone number or email','Send my request','Privacy information','Is my request a confirmed booking?']){
    assert.match(translate(key,'ka'),/[ა-ჰ]/);
    assert.equal(translate(key,'en'),key);
  }
  assert.equal(translate('Owner-specific tour description','ka'),'Owner-specific tour description');
  assert.ok(Object.keys(georgian).length>150);
});
