import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// La app se sirve desde app://margin/ dentro de Electron: rutas relativas y todo empaquetado.
export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 2500, sourcemap: true },
  server: { port: 5199, strictPort: true },
});
