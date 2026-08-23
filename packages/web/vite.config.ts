import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // Deep import into three/addons for UnrealBloomPass isn't in the initial
    // scan, so pre-bundle explicitly to avoid a dev full-reload on first
    // Graph-tab open.
    include: ['three', 'react-force-graph-3d'],
  },
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
