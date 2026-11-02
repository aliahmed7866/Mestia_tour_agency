import {env} from 'cloudflare:workers';
import {AppError} from './domain';
import {verifiedOwner} from './access-auth';

const bytes=new TextEncoder();
const cfg=()=>env as unknown as Record<string,string|undefined>;
export function ownerLoginMode(){return cfg().DEPLOY_TARGET!=='cloudflare'?'sites':cfg().OWNER_LOGIN_MODE==='native'?'native':'access';}
const db=()=>{if(!env.DB)throw new AppError('Database unavailable.',503);return env.DB;};
const hex=(b:Uint8Array)=>Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');
const random=(n=32)=>hex(crypto.getRandomValues(new Uint8Array(n)));
async function sha(value:string){return hex(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes.encode(value))));}
async function hmac(value:string){const secret=cfg().OWNER_AUTH_SECRET;if(!secret||secret.length<32)throw new AppError('Owner authentication is not configured.',503);const key=await crypto.subtle.importKey('raw',bytes.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return hex(new Uint8Array(await crypto.subtle.sign('HMAC',key,bytes.encode(value))));}
async function passwordHash(password:string,salt:string){const pepper=cfg().OWNER_AUTH_SECRET;if(!pepper||pepper.length<32)throw new AppError('Owner authentication is not configured.',503);const key=await crypto.subtle.importKey('raw',bytes.encode(password+'|'+pepper),'PBKDF2',false,['deriveBits']);return hex(new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',salt:bytes.encode(salt),iterations:310000,hash:'SHA-256'},key,256)));}
function equal(a:string,b:string){if(a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;}
const ownerEmail=()=>cfg().ADMIN_EMAIL?.trim().toLowerCase()||'';
function validPassword(p:unknown):asserts p is string{if(typeof p!=='string'||p.length<14||p.length>128)throw new AppError('Use a password of 14–128 characters.');}
async function throttle(key:string,limit:number,seconds:number){const now=Math.floor(Date.now()/1000);const row=await db().prepare('INSERT INTO owner_login_attempts(key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at<? THEN 1 ELSE count+1 END,expires_at=CASE WHEN expires_at<? THEN excluded.expires_at ELSE expires_at END RETURNING count').bind(key,now+seconds,now,now).first<{count:number}>();if((row?.count||0)>limit)throw new AppError('Too many attempts. Please try again later.',429);}
async function limit(req:Request,kind:string){const ip=req.headers.get('cf-connecting-ip')||'unknown';await throttle(await hmac(kind+':'+ip),kind==='code'?8:12,900);}
export async function hasOwnerPassword(){const row=await db().prepare('SELECT id FROM owner_credentials WHERE id=1').first();return !!row;}
export async function setupPassword(req:Request,password:unknown){
  // Setup requires the existing verified Cloudflare Access owner; never an anonymous bootstrap.
  if(ownerLoginMode()!=='access')throw new AppError('Password setup requires the existing Access owner session.',403);
  const identity=await verifiedOwner(req);validPassword(password);
  const settings=await db().prepare("SELECT data FROM settings WHERE id='business'").first<{data:string}>();
  if(settings && JSON.parse(settings.data).adminUserId && JSON.parse(settings.data).adminUserId!==identity)throw new AppError('Owner identity does not match the existing workspace.',403);
  const email=ownerEmail();if(!email)throw new AppError('Owner email not configured.',503);
  const salt=random(24),hash=await passwordHash(password,salt);
  const inserted=await db().prepare('INSERT INTO owner_credentials(id,email,salt,password_hash,created_at) VALUES (1,?,?,?,?) ON CONFLICT(id) DO NOTHING RETURNING id').bind(email,salt,hash,new Date().toISOString()).first();
  if(!inserted)throw new AppError('Owner password is already configured.',409);
  return {ok:true};
}
export async function startLogin(req:Request,email:unknown,password:unknown){
  if(ownerLoginMode()!=='native')throw new AppError('Email-code sign-in is not enabled yet. Use your existing owner access.',403);
  await limit(req,'password');
  if(typeof email!=='string'||typeof password!=='string'||password.length>128)throw new AppError('Invalid sign-in details.',401);
  const row=await db().prepare('SELECT email,salt,password_hash FROM owner_credentials WHERE id=1').first<{email:string;salt:string;password_hash:string}>();
  if(!row||!ownerEmail()||row.email!==ownerEmail())throw new AppError('Owner login is not yet configured for this owner.',503);
  const hash=await passwordHash(password,row.salt);
  if(!equal(row.password_hash,hash)||email.trim().toLowerCase()!==row.email)throw new AppError('Invalid sign-in details.',401);
  const key=cfg().RESEND_API_KEY,from=cfg().OWNER_EMAIL_FROM;
  if(!key||!from)throw new AppError('Verification email is not configured.',503);
  await throttle(await hmac('email:'+row.email),5,900);
  const code=String(crypto.getRandomValues(new Uint32Array(1))[0]%1000000).padStart(6,'0');
  const challenge=random(24),expires=Math.floor(Date.now()/1000)+300;
  await db().prepare('INSERT INTO owner_codes(id,challenge,code_hash,attempts,expires_at) VALUES (1,?,?,0,?) ON CONFLICT(id) DO UPDATE SET challenge=excluded.challenge,code_hash=excluded.code_hash,attempts=0,expires_at=excluded.expires_at').bind(await sha(challenge),await hmac('code:'+ownerEmail()+':'+challenge+':'+code),expires).run();
  try {
  const response=await fetch('https://api.resend.com/emails',{method:'POST',signal:AbortSignal.timeout(10000),headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({from,to:[row.email],subject:'Svaneti Guide sign-in code',text:'Your Svaneti Guide owner sign-in code is '+code+'. It expires in 5 minutes. If this was not you, ignore this email.'})});
  if(!response.ok)throw new Error('Email delivery failed');
  }catch{await db().prepare('DELETE FROM owner_codes WHERE id=1 AND challenge=?').bind(await sha(challenge)).run();throw new AppError('Verification email could not be sent. Try again.',503);}
  return {challenge};
}
export async function finishLogin(req:Request,challenge:unknown,code:unknown){
  if(ownerLoginMode()!=='native')throw new AppError('Email-code sign-in is not enabled yet.',403);
  await limit(req,'code');
  if(typeof challenge!=='string'||!/^[a-f0-9]{48}$/.test(challenge)||typeof code!=='string'||!/^[0-9]{6}$/.test(code))throw new AppError('Invalid verification code.',401);
  const now=Math.floor(Date.now()/1000),hashed=await sha(challenge);
  const row=await db().prepare('UPDATE owner_codes SET attempts=attempts+1 WHERE id=1 AND challenge=? AND expires_at>? AND attempts<5 RETURNING code_hash').bind(hashed,now).first<{code_hash:string}>();
  if(!row||!equal(row.code_hash,await hmac('code:'+ownerEmail()+':'+challenge+':'+code)))throw new AppError('Invalid or expired verification code.',401);
  const deleted=await db().prepare('DELETE FROM owner_codes WHERE id=1 AND challenge=? AND code_hash=?').bind(hashed,row.code_hash).run();
  if(deleted.meta.changes!==1)throw new AppError('Verification code already used.',401);
  const token=random(),tokenHash=await hmac('session:'+ownerEmail()+':'+token);
  await db().prepare('INSERT INTO owner_sessions(token_hash,expires_at,created_at) VALUES (?,?,?)').bind(tokenHash,now+8*3600,new Date().toISOString()).run();
  return token;
}
export function sessionCookie(token:string){return 'svaneti_owner='+token+'; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800';}
export const clearCookie='svaneti_owner=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0';
function cookie(req:Request){return req.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith('svaneti_owner='))?.slice(14)||'';}
export async function nativeOwner(req:Request){if(!ownerEmail())throw new AppError('Owner email not configured.',503);const token=cookie(req);if(!/^[a-f0-9]{64}$/.test(token))throw new AppError('Sign in to access the owner panel.',401);const row=await db().prepare('SELECT expires_at FROM owner_sessions WHERE token_hash=?').bind(await hmac('session:'+ownerEmail()+':'+token)).first<{expires_at:number}>();if(!row||row.expires_at<=Math.floor(Date.now()/1000))throw new AppError('Owner session expired. Sign in again.',401);return ownerEmail();}
export async function logout(req:Request){const token=cookie(req);if(/^[a-f0-9]{64}$/.test(token))await db().prepare('DELETE FROM owner_sessions WHERE token_hash=?').bind(await hmac('session:'+ownerEmail()+':'+token)).run();}
export async function ownerIdentity(req:Request){return ownerLoginMode()==='native'?nativeOwner(req):verifiedOwner(req);}
export async function ownerAuthStatus(req:Request){
  const mode=ownerLoginMode();
  // Legacy Sites/Access access must not depend on optional native-auth tables or secrets.
  if(mode!=='native'){
    let authenticated=false;
    if(mode==='access'){
      try{await verifiedOwner(req);authenticated=true;}catch(e){if(!(e instanceof AppError)||![401,403].includes(e.status))throw e;}
    }
    let canSetup=false;
    if(mode==='access'&&authenticated&&cfg().OWNER_PASSWORD_SETUP==='enabled'&&(cfg().OWNER_AUTH_SECRET?.length||0)>=32){
      try{canSetup=!(await hasOwnerPassword());}catch{ /* An unapplied native migration must not block Access. */ }
    }
    return mode==='access'?{mode,canSetup,authenticated}:{mode,canSetup};
  }
  const configured=await hasOwnerPassword();
  let authenticated=false;
  try{await nativeOwner(req);authenticated=true;}catch(e){if(!(e instanceof AppError)||e.status!==401)throw e;}
  return {mode,configured,authenticated};
}
