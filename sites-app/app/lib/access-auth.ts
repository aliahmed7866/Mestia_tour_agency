import {env} from 'cloudflare:workers';
import {AppError} from './domain';

// Production authentication: verify Cloudflare Access JWT signatures and claims.
// A user-supplied identity header is never sufficient on the public deployment.
const encoder=new TextEncoder();
function decode(value:string):any{
  try {return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0))));}
  catch {throw new AppError('Invalid owner session.',401);}
}
function config(){
  const vars=env as unknown as Record<string,string|undefined>;
  const team=vars.ACCESS_TEAM_DOMAIN?.trim();
  const aud=vars.ACCESS_AUD?.trim();
  const owner=vars.ADMIN_EMAIL?.trim().toLowerCase();
  if(!team||!aud||!owner||!/^[-a-z0-9]+\.cloudflareaccess\.com$/.test(team))throw new AppError('Owner authentication is not configured.',503);
  return {team,aud,owner};
}
export async function verifiedOwner(req:Request):Promise<string>{
  const {team,aud,owner}=config();
  const token=req.headers.get('Cf-Access-Jwt-Assertion');
  if(!token)throw new AppError('Sign in through Cloudflare Access.',401);
  const parts=token.split('.');
  if(parts.length!==3)throw new AppError('Invalid owner session.',401);
  const header=decode(parts[0]);const payload=decode(parts[1]);
  if(header.alg!=='RS256'||typeof header.kid!=='string')throw new AppError('Invalid owner session.',401);
  const now=Math.floor(Date.now()/1000);
  if(payload.iss!==`https://${team}`||!Array.isArray(payload.aud)||!payload.aud.includes(aud)||
    typeof payload.exp!=='number'||payload.exp<=now||typeof payload.nbf==='number'&&payload.nbf>now||
    typeof payload.iat==='number'&&payload.iat>now+60||typeof payload.email!=='string'||payload.email.toLowerCase()!==owner)
    throw new AppError('Owner access is required.',403);
  const response=await fetch(`https://${team}/cdn-cgi/access/certs`);
  if(!response.ok)throw new AppError('Unable to verify owner session.',503);
  const keys=await response.json() as {keys?:JsonWebKey[]};
  const jwk=keys.keys?.find(k=>(k as JsonWebKey & {kid?:string}).kid===header.kid&&k.kty==='RSA');
  if(!jwk)throw new AppError('Invalid owner session.',401);
  const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  const signature=Uint8Array.from(atob(parts[2].replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
  const valid=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,signature,encoder.encode(parts[0]+'.'+parts[1]));
  if(!valid)throw new AppError('Invalid owner session.',401);
  return owner;
}
