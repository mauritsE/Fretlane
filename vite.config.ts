import { defineConfig, type Plugin } from 'vite';
import { alphaTab } from '@coderline/alphatab-vite';

// alphaTab draws "rendered by alphaTab" under every score and has no setting for it.
// Stub out the method that lays it out; the credit lives in the README instead.
function hideAlphaTabCredit(): Plugin {
  const method = /_layoutAndRenderAnnotation\((\w+)\)\s*\{/;
  return {
    name: 'fretlane-hide-alphatab-credit',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('@coderline/alphatab/dist/') || !code.includes('rendered by alphaTab')) return null;
      if (!method.test(code)) this.error('alphaTab credit method not found; update hideAlphaTabCredit()');
      return { code: code.replace(method, (m, y) => `${m} return ${y};`), map: null };
    },
  };
}

export default defineConfig({
  // The alphaTab plugin copies fonts + soundfont and wires up the audio worker/worklet.
  plugins: [hideAlphaTabCredit(), alphaTab()],
  // Rendering can run in alphaTab's web worker, which Vite bundles with its own plugin list.
  worker: { plugins: () => [hideAlphaTabCredit()] },
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
