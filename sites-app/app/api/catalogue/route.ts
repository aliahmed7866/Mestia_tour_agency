import {respond,getSettings,getServices,publicSettings} from '../../lib/server';
import {publicDepartures} from '../../lib/inventory-server';
export async function GET(){return respond(async()=>({settings:publicSettings(await getSettings()),services:(await getServices()).filter(s=>s.published),departures:await publicDepartures()}));}
