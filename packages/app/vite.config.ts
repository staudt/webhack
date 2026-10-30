import { defineConfig } from 'vite';

export default defineConfig({
  worker: { format: 'es' },
  server: { host: false },
  build: { target: 'es2022' },
});
