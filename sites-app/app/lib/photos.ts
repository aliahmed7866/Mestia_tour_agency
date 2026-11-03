export const MAX_PHOTO_BYTES=384*1024;
export type Photo={url:string;alt:string};
export function safePhotoUrl(value:string){return /^\/(?!\/)[^\\\s]*$/.test(value)||/^https:\/\/[^\s\\]+$/.test(value);}
export function servicePhotos(service:{photos?:Photo[];image:string;title:string}):Photo[]{
 const photos=(service.photos||[]).filter(p=>safePhotoUrl(p.url));
 return photos.length?photos:safePhotoUrl(service.image)?[{url:service.image,alt:service.title}]:[];
}
// JPEG uploads only: browsers re-encode supported input images, stripping EXIF/GPS.
export function validatePhoto(data:Uint8Array){
 if(data.length>MAX_PHOTO_BYTES)throw new Error('Photo is too large. Please upload a smaller image.');
 if(data.length<12||data[0]!==255||data[1]!==216||data.at(-2)!==255||data.at(-1)!==217)throw new Error('Upload a valid JPEG photo.');
 let offset=2;
 while(offset+8<data.length){
  if(data[offset++]!==255)break;
  while(data[offset]===255)offset++;
  const marker=data[offset++];if(marker===218||marker===217)break;
  const length=(data[offset]<<8)|data[offset+1];if(length<2||offset+length>data.length)break;
  if([192,193,194].includes(marker)){
   const h=(data[offset+3]<<8)|data[offset+4],w=(data[offset+5]<<8)|data[offset+6];
   if(w<1||h<1||w>2400||h>2400||w*h>4000000)throw new Error('Photo dimensions are too large.');
   return;
  }
  offset+=length;
 }
 throw new Error('This photo could not be read. Try another image.');
}
