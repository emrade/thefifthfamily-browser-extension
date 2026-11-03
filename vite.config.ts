import { defineConfig } from 'vite';
import webExtension from 'vite-plugin-web-extension';

export default defineConfig({
  plugins: [
    webExtension({
      manifest: 'manifest.json',
      watchFilePaths: ['package.json', 'manifest.json'],
      // Extension pages not named in the manifest (opened with tabs.create).
      additionalInputs: ['src/dashboard/index.html'],
    }),
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    minify: true,
    sourcemap: false,
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
});
