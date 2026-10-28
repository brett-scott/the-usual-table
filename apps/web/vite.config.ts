import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  envDir: '../..',
  base: loadEnv(mode, '../..', '').VITE_BASE_PATH || '/',
  server: { port: 5173, strictPort: true },
}));
