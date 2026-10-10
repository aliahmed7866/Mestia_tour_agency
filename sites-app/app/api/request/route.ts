import {respond,body,guestAction} from '../../lib/server';
export async function POST(request:Request){return respond(async()=>guestAction(request,await body(request)));}
