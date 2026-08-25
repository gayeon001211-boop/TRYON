import { FilesetResolver, FaceLandmarker } from '@mediapipe/tasks-vision';

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

let imageLandmarker;
/** Face landmarks of a still image, or null if there is no face in it. */
export async function detectInImage(img) {
  if (!imageLandmarker) {
    const files = await FilesetResolver.forVisionTasks(WASM);
    imageLandmarker = await FaceLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: MODEL }, runningMode: 'IMAGE', numFaces: 1,
    });
  }
  return imageLandmarker.detect(img)?.faceLandmarks?.[0] ?? null;
}

/** Otsu: split a luminance histogram into dark / light without a magic number. */
export function otsu(hist, total) {
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sumB += t * hist[t];
    const between = wB * wF * ((sumB / wB) - ((sum - sumB) / wF)) ** 2;
    if (between > best) { best = between; thr = t; }
  }
  return thr;
}

/**
 * Cut the segmented object out of the image.
 * SAM returns the glasses as a solid blob, lenses included, so the light pixels
 * inside it are turned back into see-through lenses.
 */
export function cutOut(img, mask, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const id = ctx.getImageData(0, 0, w, h), d = id.data;

  const hist = new Uint32Array(256), lum = new Uint8Array(w * h);
  let inside = 0;
  for (let p = 0; p < mask.length; p++) {
    if (!mask[p]) continue;
    lum[p] = (d[p * 4] * 299 + d[p * 4 + 1] * 587 + d[p * 4 + 2] * 114) / 1000 | 0;
    hist[lum[p]]++; inside++;
  }
  const thr = otsu(hist, inside);
  for (let p = 0; p < mask.length; p++) {
    d[p * 4 + 3] = !mask[p] ? 0 : lum[p] <= thr ? 255 : 70;   // rim solid, lens tinted
  }
  ctx.putImageData(id, 0, 0);
  return c;
}

/** Crop away fully transparent margins. Returns null if nothing survived. */
export function trim(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let x0 = canvas.width, y0 = canvas.height, x1 = -1, y1 = -1;
  for (let p = 0, n = canvas.width * canvas.height; p < n; p++) {
    if (data[p * 4 + 3] < 8) continue;
    const x = p % canvas.width, y = (p - x) / canvas.width;
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < 0 || x1 - x0 < 4) return null;
  const out = document.createElement('canvas');
  out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
  out.getContext('2d').drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return { canvas: out, x: x0, y: y0 };
}
