import vinext from 'vinext';
import {defineConfig} from 'vite';
import {cloudflare} from '@cloudflare/vite-plugin';

// Standalone production build, deliberately excludes Sites hosting plugins and mock auth.
export default defineConfig({
  plugins:[vinext(),cloudflare({viteEnvironment:{name:'rsc',childEnvironments:['ssr']}})]
});
