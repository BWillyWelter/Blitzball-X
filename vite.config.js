import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: '.',
  base: './', // Ensures relative pathing for file:// protocols in native mobile webviews
  publicDir: 'public',

  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true, // Strips debugging logs in production builds
        drop_debugger: true
      }
    },
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html')
      },
      output: {
        // Modular vendor splitting for faster initial webview loading
        manualChunks(id) {
          if (id.includes('node_modules/three')) {
            return 'three-vendor';
          }
        }
      }
    },
    target: 'es2020',
    chunkSizeWarningLimit: 1000
  },

  server: {
    host: true,
    port: 3000,
    open: true
  }
});
