import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relativ base ('./') sammen med HashRouter gjør at bygget fungerer sømløst
// på både https://<bruker>.github.io/<repo>/ og egne domener.
export default defineConfig({
  base: './',
  plugins: [react()],
});
