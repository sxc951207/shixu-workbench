import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
import {prepareOcrAssets} from '../scripts/prepare-ocr-assets.mjs';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/workbench/',
  publicDir: '../public',
  envDir: false,
  plugins: [react(), {name:'prepare-local-ocr',buildStart: prepareOcrAssets}],
  build: {outDir:'../dist/web',emptyOutDir:true,license:{fileName:'licenses/bundled-dependencies.md'}}
});