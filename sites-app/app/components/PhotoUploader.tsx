'use client';
import {useRef,useState} from 'react';
import {Upload,ArrowLeft,ArrowRight,Trash2} from 'lucide-react';
import {MAX_PHOTO_BYTES,servicePhotos,type Photo} from '../lib/photos';
import type {Service} from '../lib/types';
async function prepare(file:File){
 if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>20*1024*1024)throw new Error('Choose JPEG, PNG or WebP photos under 20 MB. For HEIC, export as JPEG first.');
 const bitmap=await createImageBitmap(file);
 try{
  if(bitmap.width*bitmap.height>60000000)throw new Error('This image is too large. Export a smaller copy.');
  const canvas=document.createElement('canvas');const scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height));canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);
  const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Your browser cannot prepare this photo.');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
  for(const quality of [.84,.7,.55,.4]){const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));if(blob&&blob.size<=MAX_PHOTO_BYTES)return blob;}
  throw new Error('This photo is too detailed to upload. Try a smaller copy.');
 }finally{bitmap.close();}
}
export default function PhotoUploader({service,onChange,onBusy,disabled}:{service:Service;onChange:(photos:Photo[])=>void;onBusy:(busy:boolean)=>void;disabled:boolean}){
 const photos=servicePhotos(service);const [uploading,setUploading]=useState(false);const [message,setMessage]=useState('');const lock=useRef(false);const input=useRef<HTMLInputElement>(null);
 async function upload(files:File[]){if(lock.current)return;if(files.length+photos.length>12){setMessage('Use up to 12 photos per service.');return;}lock.current=true;setUploading(true);onBusy(true);setMessage('Preparing photos…');let next=[...photos];
 try{for(const [i,file] of files.entries()){setMessage(`Uploading photo ${i+1} of ${files.length}…`);const blob=await prepare(file);const response=await fetch('/api/admin/photos',{method:'POST',headers:{'Content-Type':'image/jpeg'},body:blob,signal:AbortSignal.timeout(45000)});const data=await response.json() as {url?:string;error?:string};if(!response.ok)throw new Error(data.error||'Upload failed. Try again.');if(!data.url||!/^\/api\/media\/[a-f0-9]{64}$/.test(data.url))throw new Error('Upload returned an invalid photo. Try again.');next=[...next,{url:data.url,alt:''}];onChange(next);}setMessage('Photos added. Add captions, then Save service to publish your gallery.');}
 catch(e){setMessage(e instanceof Error?e.message:'Upload failed. Try again.');}finally{lock.current=false;setUploading(false);onBusy(false);if(input.current)input.current.value='';}}
 function move(index:number,step:number){const next=[...photos];[next[index],next[index+step]]=[next[index+step],next[index]];onChange(next);}
 return <section className="admin-photo-editor" aria-label="Service photos"><h3>Photo gallery</h3><p>Upload up to 12 photos. The first photo is the cover. Photos are public; choose images you have permission to share.</p><input ref={input} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={e=>void upload(Array.from(e.target.files||[]))}/><button className="admin-btn" type="button" disabled={disabled||uploading||photos.length>=12} onClick={()=>input.current?.click()}><Upload size={17}/>{uploading?'Uploading…':'Upload photos'}</button><p role="status" aria-live="polite">{message}</p><div className="admin-photo-grid">{photos.map((photo,index)=><div className="admin-photo" key={photo.url+index}><img src={photo.url} alt={photo.alt||'Uploaded service photo'}/><strong>{index===0?'Cover photo':`Photo ${index+1}`}</strong><label>Photo description<input maxLength={180} placeholder="e.g. View over Mestia from the trail" value={photo.alt} disabled={disabled||uploading} onChange={e=>onChange(photos.map((p,i)=>i===index?{...p,alt:e.target.value}:p))}/></label><div><button type="button" aria-label={`Move photo ${index+1} earlier`} disabled={disabled||uploading||index===0} onClick={()=>move(index,-1)}><ArrowLeft size={16}/></button><button type="button" aria-label={`Move photo ${index+1} later`} disabled={disabled||uploading||index===photos.length-1} onClick={()=>move(index,1)}><ArrowRight size={16}/></button><button type="button" aria-label={`Remove photo ${index+1} from gallery`} disabled={disabled||uploading} onClick={()=>onChange(photos.filter((_,i)=>i!==index))}><Trash2 size={16}/></button></div></div>)}</div></section>;
}
