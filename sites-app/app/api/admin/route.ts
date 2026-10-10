import {respond,adminData,body,mutateAdmin} from '../../lib/server';
export async function GET(request:Request){return respond(()=>adminData(request));}
export async function POST(request:Request){return respond(async()=>mutateAdmin(request,await body(request)));}
