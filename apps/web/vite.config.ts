import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    allowedHosts: ['untaxed-collector-wrench.ngrok-free.dev'],
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5000',
        changeOrigin: true
      },
      '/health': {
        target: 'http://127.0.0.1:5000',
        changeOrigin: true
      }
    }
  }
});
