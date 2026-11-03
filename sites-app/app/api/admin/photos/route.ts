import {respond,requireAdmin,sameOrigin,database} from '../../../lib/server';
import {AppError} from '../../../lib/domain';
import {MAX_PHOTO_BYTES,validatePhoto} from '../../../lib/photos';
export async function POST(req:Request){return respond(async()=>{
 sameOrigin(req);await requireAdmin(req);
 if(req.headers.get('content-type')?.split(';')[0]!=='image/jpeg')throw new AppError('Choose a JPEG, PNG or WebP photo using the upload button.',415);
 if(Number(req.headers.get('content-length')||0)>MAX_PHOTO_BYTES)throw new AppError('Photo is too large.',413);
 const reader=req.body?.getReader();if(!reader)throw new AppError('Choose a photo.');
 const chunks:Uint8Array[]=[];let size=0;
 try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>MAX_PHOTO_BYTES){await reader.cancel();throw new AppError('Photo is too large.',413);}chunks.push(value);}}finally{reader.releaseLock();}
 const data=new Uint8Array(size);let offset=0;for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.length;}
 try{validatePhoto(data);}catch(e){throw new AppError(e instanceof Error?e.message:'Invalid photo.');}
 const id=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),x=>x.toString(16).padStart(2,'0')).join('');
 const db=database();
 if(!await db.prepare('SELECT id FROM service_photos WHERE id=?').bind(id).first()){
  const result=await db.prepare('INSERT OR IGNORE INTO service_photos(id,data,created_at) SELECT ?,?,? WHERE (SELECT COUNT(*) FROM service_photos)<200').bind(id,data,new Date().toISOString()).run();
  if(!result.meta.changes&&!await db.prepare('SELECT id FROM service_photos WHERE id=?').bind(id).first())throw new AppError('Photo storage is full. Contact the site administrator to increase storage.',409);
 }
 return {url:'/api/media/'+id};
});}
