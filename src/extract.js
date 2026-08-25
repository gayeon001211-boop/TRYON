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

/** Where the glasses must be on that face: temple to temple, brow to under-eye. */
export function glassesBox(lm, w, h) {
  const X = i => lm[i].x * w, Y = i => lm[i].y * h;
  const x0 = Math.min(X(127), X(356)), x1 = Math.max(X(127), X(356));
  const top = Math.min(Y(105), Y(334)), bottom = Math.max(Y(145), Y(374));
  const padY = (bottom - top) * 0.55, padX = (x1 - x0) * 0.04;
  return {
    x: Math.max(0, x0 - padX), y: Math.max(0, top - padY),
    w: Math.min(w, x1 + padX) - Math.max(0, x0 - padX),
    h: Math.min(h, bottom + padY) - Math.max(0, top - padY),
  };
}

/** Otsu: split a luminance histogram into dark / light without a magic number. */
function otsu(hist, total) {
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

/** 4-neighbour labelling; returns [label array, per-label {area, minY, maxY, minX, maxX}]. */
function components(mask, w, h) {
  const label = new Int32Array(w * h).fill(-1), stack = [], blobs = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || label[i] >= 0) continue;
    const id = blobs.length, b = { area: 0, minY: h, maxY: 0, minX: w, maxX: 0 };
    blobs.push(b); label[i] = id; stack.push(i);
    while (stack.length) {
      const p = stack.pop(), x = p % w, y = (p - x) / w;
      b.area++; b.minY = Math.min(b.minY, y); b.maxY = Math.max(b.maxY, y);
      b.minX = Math.min(b.minX, x); b.maxX = Math.max(b.maxX, x);
      const nb = [x > 0 && p - 1, x < w - 1 && p + 1, y > 0 && p - w, y < h - 1 && p + w];
      for (const n of nb) if (n !== false && mask[n] && label[n] < 0) { label[n] = id; stack.push(n); }
    }
  }
  return [label, blobs];
}

/**
 * Keep the dark parts that sit on the eye line — the frame — and drop skin, wall and hair.
 * `sens` (0.6–1.5) nudges the automatic threshold; it is the one knob a photo may need.
 */
export function maskGlasses(imgData, sens = 1) {
  const { width: w, height: h, data } = imgData;
  const lum = new Uint8Array(w * h), hist = new Uint32Array(256);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const l = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000 | 0;
    lum[p] = l; hist[l]++;
  }
  const thr = Math.min(250, otsu(hist, w * h) * sens);
  const mask = new Uint8Array(w * h);
  for (let p = 0; p < lum.length; p++) mask[p] = lum[p] <= thr ? 1 : 0;  // otsu's t belongs to the dark class

  // the frame is one big connected run of dark pixels across the eye line;
  // brows, lashes, pupils and hair are smaller islands, so keep only the big ones
  const [label, blobs] = components(mask, w, h);
  const bandTop = h * 0.3, bandBottom = h * 0.8;
  const onBand = blobs.map(b => b.minY < bandBottom && b.maxY > bandTop);
  const biggest = Math.max(0, ...blobs.filter((_, i) => onBand[i]).map(b => b.area));
  const keep = blobs.map((b, i) =>
    onBand[i] && b.area > biggest * 0.25 && b.maxX - b.minX > w * 0.08);

  for (let p = 0; p < mask.length; p++) {
    if (!(mask[p] && keep[label[p]])) data[p * 4 + 3] = 0;
  }
  return imgData;
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
  return out;
}
