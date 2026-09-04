import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  base: mode === 'production' ? '/chronicles-of-chaos/' : '/',
  plugins: [react()],
  server: {
    port: 3000,
    open: mode !== 'e2e',
  },
  test: {
    environment: 'node',
    exclude: ['node_modules/**', 'dist/**', 'output/**', '.tmp/**', 'tests/e2e/**'],
  },
}));
