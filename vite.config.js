import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Cross-origin isolation lets onnxruntime-web run wasm on every core instead of one.
// 'credentialless' keeps the cross-origin model downloads (jsdelivr, huggingface) working.
const isolate = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
};

const port = process.env.PORT ? Number(process.env.PORT) : 5173;

export default defineConfig({
  plugins: [react()],
  server: { port, headers: isolate },
  preview: { port, headers: isolate },
});
