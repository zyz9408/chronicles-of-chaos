import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: {
    port: 3000,
    open: mode !== 'e2e',
  },
  test: {
    environment: 'node',
    exclude: ['node_modules/**', 'dist/**', 'output/**', 'tests/e2e/**'],
  },
}));
