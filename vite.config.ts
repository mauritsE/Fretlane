import { defineConfig } from 'vite';
import { alphaTab } from '@coderline/alphatab-vite';

export default defineConfig({
  // The alphaTab plugin copies fonts + soundfont and wires up the audio worker/worklet.
  plugins: [alphaTab()],
  // alphaTab locates its worker/worklet relative to its own module file; pre-bundling would move it.
  // alphaTab is a ~1 MB library; the chunk size warning is expected.
  build: { chunkSizeWarningLimit: 3000 },
  optimizeDeps: { exclude: ['@coderline/alphatab'] },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:5174' },
  },
});
