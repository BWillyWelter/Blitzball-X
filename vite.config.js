import { defineConfig } from 'vite';

/**
 * Extra preview hosts, passed per process so a machine-specific hostname never has to be
 * committed: `VITE_ALLOWED_HOSTS=preview.example.com npm run dev`.
 */
const extraHosts = String(process.env.VITE_ALLOWED_HOSTS || '')
  .split(',')
  .map((host) => host.trim())
  .filter(Boolean);

export default defineConfig({
  base: './',
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    // Allow Arena's sandboxed preview host while keeping ordinary external hosts blocked.
    allowedHosts: ['.e2b.app', ...extraHosts],
    // The online-duel room server (npm run server) is a second process on :4000. Proxying it
    // means the browser talks to one origin in development, exactly as a deployment would.
    proxy: {
      '/ws': { target: 'ws://localhost:4000', ws: true, changeOrigin: true },
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    strictPort: true,
    allowedHosts: ['.e2b.app', ...extraHosts],
    proxy: {
      '/ws': { target: 'ws://localhost:4000', ws: true, changeOrigin: true },
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
    },
  },
  build: {
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
        },
      },
    },
  },
});
