import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'html-rewrite',
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          const url = req.url || '';
          if (url.startsWith('/remote') && !url.startsWith('/remote.html')) {
            req.url = url.replace(/^\/remote(\?.*)?$/, '/remote.html$1');
          } else if (url.startsWith('/output') && !url.startsWith('/output.html')) {
            req.url = url.replace(/^\/output(\?.*)?$/, '/output.html$1');
          } else if (url.startsWith('/studio') && !url.startsWith('/studio.html')) {
            req.url = url.replace(/^\/studio(\?.*)?$/, '/studio.html$1');
          }
          next();
        });
      }
    }
  ],
  build: {
    rollupOptions: {
      input: {
        studio: resolve(__dirname, 'studio.html'),
        output: resolve(__dirname, 'output.html'),
        index: resolve(__dirname, 'index.html'),
        remote: resolve(__dirname, 'remote.html')
      }
    }
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    // Allow all tunnel domains (localtunnel, cloudflare, ngrok) permanently without manual entry
    allowedHosts: true,
    proxy: {
      '/socket.io': { target: 'http://localhost:3001', ws: true },
      '/api': 'http://localhost:3001'
    }
  }
});
