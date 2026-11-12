/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { localApiPlugin } from './server/api';

export default defineConfig({
  plugins: [react(), localApiPlugin()],
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  preview: { host: '127.0.0.1' },
  test: {
    environment: 'node',
    include: ['src/tests/**/*.test.ts', 'src/tests/**/*.test.tsx', 'backend/**/*.test.ts'],
  },
});
