import { defineConfig } from 'vite';
import { pagesBase } from './config/pagesBase';

export default defineConfig({
  base: pagesBase(),
  publicDir: false,
  build: { sourcemap: false, assetsInlineLimit: 0 },
  plugins: [{
    name: 'private-local-paths',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        let path: string;
        try { path = new URL(decodeURIComponent(req.url ?? '/'), 'http://localhost').pathname; }
        catch { res.statusCode = 400; res.end(); return; }
        if (/^\/(input|artifacts|data)(\/|$)/.test(path)) {
          res.statusCode = 403; res.end('Private project directory.'); return;
        }
        if (path === '/__cats-room/' || path === '/__cats-room') {
          res.statusCode = 302; res.setHeader('Location', '/'); res.end(); return;
        }
        next();
      });
    },
  }],
  server: {
    port: 5173, strictPort: true,
    fs: { deny: ['.env', '.env.*', '*.{crt,pem,key,p12,pfx,cer,der}', '.npmrc', '.yarnrc.yml',
      '**/.git/**', '**/input/**', '**/data/**', '**/artifacts/**'] },
  },
  preview: { port: 4173, strictPort: true },
});
