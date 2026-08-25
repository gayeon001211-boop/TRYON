import { SamModel, AutoProcessor, RawImage, Tensor, env } from '@huggingface/transformers';

const MODEL = 'Xenova/slimsam-77-uniform';   // ~40 MB Segment Anything, runs locally

let loading;
export let backend = '';   // what actually ran, for the UI to own up to

/** Load SlimSAM once. `onProgress` gets 0–1 while the weights download. */
export function loadSam(onProgress) {
  if (!loading) loading = (async () => {
    const progress_callback = p => p.status === 'progress' && onProgress?.(p.progress / 100);
    // WebGPU is ~100× faster here, but only if an adapter really exists
    const adapter = await navigator?.gpu?.requestAdapter?.().catch(() => null);
    const node = typeof window === 'undefined';
    const device = adapter ? 'webgpu' : node ? 'cpu' : 'wasm';
    if (device === 'wasm') {
      env.backends.onnx.wasm.numThreads = globalThis.crossOriginIsolated
        ? Math.min(8, navigator.hardwareConcurrency || 4) : 1;
      backend = `wasm ×${env.backends.onnx.wasm.numThreads}`;
    } else backend = device;

    const [model, processor] = await Promise.all([
      SamModel.from_pretrained(MODEL, { dtype: adapter ? 'fp16' : 'q8', device, progress_callback }),
      AutoProcessor.from_pretrained(MODEL),
    ]);
    return { model, processor };
  })();
  return loading;
}

/**
 * Prompt points for a pair of glasses on a face, in image pixels.
 * Positives sit on the top rim and the bridge, negatives on skin — so SAM
 * takes the frame and leaves the face, the hair and the wall behind.
 */
export function pickPoints(lm, w, h) {
  const at = i => [lm[i].x * w, lm[i].y * h];
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  return [
    { p: at(168), label: 1 },                        // bridge of the nose
    { p: mid(at(159), at(105)), label: 1 },          // left top rim
    { p: mid(at(386), at(334)), label: 1 },          // right top rim
    { p: at(50), label: 0 }, { p: at(280), label: 0 },   // cheeks
    { p: at(10), label: 0 }, { p: at(152), label: 0 },   // forehead, chin
  ];
}

/**
 * Encode the image once (the slow part, seconds) so that later point prompts
 * only have to run the decoder (milliseconds).
 */
export async function embed(image) {
  const { model, processor } = await loadSam();
  const raw = image instanceof RawImage ? image : await RawImage.read(image);
  const inputs = await processor(raw);
  return { inputs, embeddings: await model.get_image_embeddings(inputs), model, processor };
}

/** Decode one set of prompt points into {mask: Uint8Array(w*h), width, height}. */
export async function segment(ctx, points) {
  const { model, processor, inputs, embeddings } = ctx;

  const input_points = new Tensor('float32', points.flatMap(q => q.p), [1, 1, points.length, 2]);
  const input_labels = new Tensor('int64', points.map(q => BigInt(q.label)), [1, 1, points.length]);
  const out = await model({ ...embeddings, input_points, input_labels });

  const masks = await processor.post_process_masks(out.pred_masks, inputs.original_sizes, inputs.reshaped_input_sizes);
  const m = masks[0];                                   // dims [1, candidates, H, W]
  const [, n, H, W] = m.dims;
  const scores = out.iou_scores.data;
  let best = 0;
  for (let i = 1; i < n; i++) if (scores[i] > scores[best]) best = i;

  const mask = new Uint8Array(W * H), src = m.data, offset = best * W * H;
  for (let i = 0; i < mask.length; i++) mask[i] = src[offset + i] ? 1 : 0;
  return { mask, width: W, height: H, score: scores[best] };
}
