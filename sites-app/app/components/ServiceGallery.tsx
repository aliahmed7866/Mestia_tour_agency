'use client';
import {useRef,useState,type ReactNode} from 'react';
import {ChevronLeft,ChevronRight} from 'lucide-react';
import {servicePhotos} from '../lib/photos';
import type {Service} from '../lib/types';
export default function ServiceGallery({service,fallback,language='en'}:{service:Service;fallback:ReactNode;language?:string}){
 const photos=servicePhotos(service);const [index,setIndex]=useState(0);const start=useRef<number|null>(null);const current=Math.min(index,Math.max(0,photos.length-1));
 if(!photos.length)return <div className="mt-detail-art">{fallback}</div>;
 const move=(step:number)=>setIndex((current+step+photos.length)%photos.length);const ka=language==='ka';
 return <section className="mt-gallery" aria-label={ka?'ფოტოგალერეა':'Photo gallery'} aria-roledescription="carousel"><div className="mt-gallery-stage" tabIndex={0} onKeyDown={e=>{if(e.key==='ArrowLeft'){e.preventDefault();move(-1);}if(e.key==='ArrowRight'){e.preventDefault();move(1);}}} onTouchStart={e=>{start.current=e.touches[0].clientX;}} onTouchEnd={e=>{if(start.current!==null){const delta=e.changedTouches[0].clientX-start.current;if(Math.abs(delta)>50)move(delta<0?1:-1);}start.current=null;}}><img src={photos[current].url} alt={photos[current].alt||`${service.title} — ${current+1}`} decoding="async"/>{photos.length>1&&<><button className="mt-gallery-prev" type="button" aria-label={ka?'წინა ფოტო':'Previous photo'} onClick={()=>move(-1)}><ChevronLeft/></button><button className="mt-gallery-next" type="button" aria-label={ka?'შემდეგი ფოტო':'Next photo'} onClick={()=>move(1)}><ChevronRight/></button><span className="mt-gallery-count" aria-live="polite">{current+1} / {photos.length}</span></>}</div>{photos[current].alt&&<p className="mt-gallery-caption">{photos[current].alt}</p>}{photos.length>1&&<div className="mt-gallery-thumbs" aria-label={ka?'აირჩიეთ ფოტო':'Choose a photo'}>{photos.map((photo,i)=><button type="button" key={photo.url+i} aria-label={`${ka?'ფოტო':'Photo'} ${i+1}`} aria-pressed={i===current} onClick={()=>setIndex(i)}><img src={photo.url} alt="" loading="lazy"/></button>)}</div>}</section>;
}
