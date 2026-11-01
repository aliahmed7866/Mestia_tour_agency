import {respond,body,sameOrigin} from '../../lib/server';
import {hasOwnerPassword,setupPassword,startLogin,finishLogin,sessionCookie,clearCookie,logout} from '../../lib/owner-auth';
import {AppError} from '../../lib/domain';
export async function GET(){return respond(async()=>({configured:await hasOwnerPassword()}));}
export async function POST(req:Request){return respond(async()=>{
  sameOrigin(req);
  const data=await body(req);
  if(data.action==='setup')return setupPassword(req,data.password);
  if(data.action==='start')return startLogin(req,data.email,data.password);
  if(data.action==='verify'){const token=await finishLogin(req,data.challenge,data.code);return new Response(JSON.stringify({ok:true}),{headers:{'Content-Type':'application/json','Cache-Control':'no-store','Set-Cookie':sessionCookie(token)}});}
  if(data.action==='logout'){await logout(req);return new Response(JSON.stringify({ok:true}),{headers:{'Content-Type':'application/json','Cache-Control':'no-store','Set-Cookie':clearCookie}});}
  throw new AppError('Unsupported action.');
});}
