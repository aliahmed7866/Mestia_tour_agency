import {respond,sameOrigin,body,createTravelRequest} from '../../lib/server';
export async function POST(request:Request){return respond(async()=>{sameOrigin(request);return createTravelRequest(request,await body(request));});}
