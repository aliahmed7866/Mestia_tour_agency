import {scryptSync} from 'node:crypto';

const prefix='scrypt$16384$8$5$';
// OWASP's 16 MiB scrypt profile fits the Worker isolate's memory budget.
// Version the stored hash so old credentials are never silently reinterpreted.
export async function deriveOwnerPassword(password:string,salt:string,pepper:string,stored?:string){
  const input=password+'|'+pepper;
  if(stored && /^[a-f0-9]{64}$/.test(stored)){
    const bytes=new TextEncoder();
    const key=await crypto.subtle.importKey('raw',bytes.encode(input),'PBKDF2',false,['deriveBits']);
    const result=await crypto.subtle.deriveBits({name:'PBKDF2',salt:bytes.encode(salt),iterations:310000,hash:'SHA-256'},key,256);
    return Array.from(new Uint8Array(result),x=>x.toString(16).padStart(2,'0')).join('');
  }
  if(stored && !/^scrypt\$16384\$8\$5\$[a-f0-9]{64}$/.test(stored))throw new Error('Unsupported owner password hash format');
  return prefix+scryptSync(input,salt,32,{N:16384,r:8,p:5,maxmem:32*1024*1024}).toString('hex');
}
