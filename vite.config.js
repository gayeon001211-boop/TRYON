import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Cross-origin isolation lets onnxruntime-web run wasm on every core instead of one.
// 'credentialless' keeps the cross-origin model downloads (jsdelivr, huggingface) working.
const isolate = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
};

export default defineConfig({
  plugins: [react()],
  server: { headers: isolate },
  preview: { headers: isolate },
});
