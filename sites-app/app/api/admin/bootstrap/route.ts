import {respond,bootstrap} from '../../../lib/server';
export async function POST(request:Request){return respond(()=>bootstrap(request));}
