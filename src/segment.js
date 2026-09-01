import { SamModel, AutoProcessor, RawImage, Tensor, env } from '@huggingface/transformers';

const MODEL = 'Xenova/slimsam-77-uniform';   // ~40 MB Segment Anything, runs in the browser
const HELPER = 'http://127.0.0.1:8791';     // the local helper, when it is running

/**
 * Is the local helper up? It runs a full-size segmentation model on this machine, which
 * is far more accurate than the browser-sized one — but it is optional, so this check is
 * short and a failure just means "carry on in the browser".
 */
let helperProbe = null;
export function helperStatus() {
  if (!helperProbe) {
    helperProbe = (async () => {
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 400);
        const res = await fetch(HELPER + '/health', { signal: ctl.signal });
        clearTimeout(t);
        if (!res.ok) return null;
        const j = await res.json();
        return { ...j, url: HELPER };
      } catch { return null; }
    })();
  }
  return helperProbe;
}

let loading;
export let backend = '';   // what actually ran, for the UI to own up to

/** Load SlimSAM once. `onProgress` gets 0–1 while the weights download. */
export function loadSam(onProgress) {
  if (!loading) loading = (async () => {
    const progress_callback = p => p.status === 'progress' && onProgress?.(p.progress / 100);
    // WebGPU spends ~45 s compiling shaders on the first run, which is longer than
    // threaded wasm takes to do the whole job for a model this small. ?gpu opts back in.
    const node = typeof window === 'undefined';
    const wantGpu = !node && location.search.includes('gpu');
    const adapter = wantGpu ? await navigator?.gpu?.requestAdapter?.().catch(() => null) : null;
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
 * Positives ring the frame (bridge + upper/lower/outer rim on both sides) so SAM
 * traces the frame material; negatives sit in the LENS CENTRES (so the openings
 * are carved out) and on skin / hair / wall.
 * `lm` may be null — then we prompt a wide band across the eyes.
 */
export function pickGlassesPoints(lm, w, h) {
  if (!lm) {
    const y = h * 0.42;
    return [
      { p: [w * 0.30, y], label: 1 }, { p: [w * 0.50, y - h * 0.03], label: 1 }, { p: [w * 0.70, y], label: 1 },
      { p: [w * 0.5, h * 0.15], label: 0 }, { p: [w * 0.5, h * 0.8], label: 0 },
      { p: [w * 0.06, y], label: 0 }, { p: [w * 0.94, y], label: 0 },
    ];
  }
  const at = i => [lm[i].x * w, lm[i].y * h];
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const eyeL = lm[468] ? at(468) : mid(mid(at(33), at(133)), mid(at(159), at(145)));
  const eyeR = lm[473] ? at(473) : mid(mid(at(263), at(362)), mid(at(386), at(374)));

  const pos = [
    at(168),                              // bridge
    mid(at(159), at(105)), mid(at(145), at(163)), at(226),        // left rim: top, bottom, outer
    mid(at(386), at(334)), mid(at(374), at(390)), at(446),        // right rim: top, bottom, outer
  ];
  const neg = [
    eyeL, eyeR,                           // ← carve the lens openings
    at(50), at(280),                      // cheeks
    at(10), at(152),                      // forehead, chin
    at(234), at(454),                     // outside the temples
    // the background itself: a selfie has a room in it, and SAM will happily take the
    // desk behind the head as part of the object unless it is told otherwise
    [w * 0.03, h * 0.03], [w * 0.97, h * 0.03],
    [w * 0.03, h * 0.97], [w * 0.97, h * 0.97],
  ];
  return [...pos.map(p => ({ p, label: 1 })), ...neg.map(p => ({ p, label: 0 }))];
}

// keep the old name working for anything that still imports it
export { pickGlassesPoints as pickPoints };

/**
 * Encode the image once (the slow part, seconds) so that later point prompts
 * only have to run the decoder (milliseconds).
 */
export async function embed(image) {
  const helper = await helperStatus();
  if (helper && image instanceof Blob) {
    // the helper needs the picture, not an encoding of it — skip the browser model entirely
    return { helper, blob: image };
  }
  const { model, processor } = await loadSam();
  // a Blob/File is the browser path; RawImage.read only understands urls and paths,
  // and throws "Unsupported input type" on an <img> element
  const raw = image instanceof RawImage ? image
    : image instanceof Blob ? await RawImage.fromBlob(image)
    : await RawImage.read(image);
  const inputs = await processor(raw);
  return { inputs, embeddings: await model.get_image_embeddings(inputs), model, processor, blob: image };
}

/**
 * Same call, better model, when the helper is up: send the photo and the prompt points to
 * the local process and get a full-size SAM mask back. `ctx` carries the source blob so
 * this path needs nothing the browser path did not already have.
 */
async function segmentViaHelper(ctx, points) {
  const dataUrl = await new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = rej;
    fr.readAsDataURL(ctx.blob);
  });
  const r = await fetch(HELPER + '/segment', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ image: dataUrl, points: points.map(p => ({ p: p.p, label: p.label })) }),
  });
  if (!r.ok) throw new Error('helper ' + r.status);
  const j = await r.json();

  // the helper answers with a PNG; unpack it to the same Uint8Array the caller expects
  const img = await new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = j.mask;
  });
  const c = document.createElement('canvas');
  c.width = j.width; c.height = j.height;
  const cx = c.getContext('2d', { willReadFrequently: true });
  cx.drawImage(img, 0, 0);
  const px = cx.getImageData(0, 0, j.width, j.height).data;
  const mask = new Uint8Array(j.width * j.height);
  for (let i = 0; i < mask.length; i++) mask[i] = px[i * 4] > 127 ? 1 : 0;
  return { mask, width: j.width, height: j.height, score: j.score, via: j.model };
}

/** Decode one set of prompt points into {mask: Uint8Array(w*h), width, height}. */
export async function segment(ctx, points) {
  if (ctx?.helper) {
    try { return await segmentViaHelper(ctx, points); }
    catch (e) { console.warn('helper segmentation failed, using the browser model', e); }
  }
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
