import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://192.168.255.235:3457',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://192.168.255.235:3457',
        ws: true,
      },
    },
  },
});
