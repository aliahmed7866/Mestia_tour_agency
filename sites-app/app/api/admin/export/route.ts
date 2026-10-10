import {respond,adminData,requireAdmin} from '../../../lib/server';
export async function GET(request:Request){const response=await respond(async()=>{await requireAdmin(request);return adminData(request);});if(response.ok)response.headers.set('Content-Disposition','attachment; filename="mestia-owner-export.json"');return response;}
