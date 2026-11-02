import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {scryptSync,pbkdf2Sync} from 'node:crypto';
import {deriveOwnerPassword} from '../app/lib/owner-password.ts';
const require=createRequire(import.meta.url);
const {Miniflare}=await import(require.resolve('miniflare',{paths:[require.resolve('wrangler')]}));
const password='runtime-test-password',salt='test-salt',pepper='test-only-pepper-not-a-real-secret';

test('production password derivation matches native scrypt inside workerd',async()=>{
  const source=ts.transpileModule(readFileSync(new URL('../app/lib/owner-password.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
  const mf=new Miniflare({modules:true,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],script:source+`\nexport default {async fetch(){return Response.json({hash:await deriveOwnerPassword(${JSON.stringify(password)},${JSON.stringify(salt)},${JSON.stringify(pepper)})});}};`});
  try{
    const response=await mf.dispatchFetch('https://test/');assert.equal(response.status,200);
    const {hash}=await response.json();
    const expected='scrypt$16384$8$5$'+scryptSync(password+'|'+pepper,salt,32,{N:16384,r:8,p:5,maxmem:32*1024*1024}).toString('hex');
    assert.equal(hash,expected);
    assert.equal(await deriveOwnerPassword(password,salt,pepper,hash),hash);
    assert.notEqual(await deriveOwnerPassword('wrong',salt,pepper,hash),hash);
  }finally{await mf.dispose();}
});

test('legacy hashes keep their original algorithm and unknown formats fail closed',async()=>{
  const legacy=pbkdf2Sync(password+'|'+pepper,salt,310000,32,'sha256').toString('hex');
  assert.equal(await deriveOwnerPassword(password,salt,pepper,legacy),legacy);
  await assert.rejects(deriveOwnerPassword(password,salt,pepper,'scrypt$1$1$1$bad'),/Unsupported/);
});
