import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Use a separate public directory so we don't clash with the existing /public
  publicDir: 'public-vite'
});









