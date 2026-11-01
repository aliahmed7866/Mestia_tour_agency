// Standalone Cloudflare Workers entry: no ChatGPT Sites preview or connector bindings.
import handler from 'vinext/server/fetch-handler';
export default {
  fetch(request:Request,env:Cloudflare.Env,ctx:ExecutionContext){
    return handler.fetch(request,env,ctx);
  }
};
