import {database} from '../../../lib/server';
export async function GET(_req:Request,{params}:{params:Promise<{id:string}>}){
 const {id}=await params;if(!/^[a-f0-9]{64}$/.test(id))return new Response('Not found',{status:404});
 const row=await database().prepare('SELECT data FROM service_photos WHERE id=?').bind(id).first<{data:number[]|ArrayBuffer}>();
 if(!row)return new Response('Not found',{status:404});
 return new Response(new Uint8Array(row.data as ArrayBuffer),{headers:{'Content-Type':'image/jpeg','Cache-Control':'public, max-age=31536000, immutable','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox",'Cross-Origin-Resource-Policy':'same-origin'}});
}
