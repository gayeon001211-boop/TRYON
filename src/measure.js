// Read a pair of glasses as PARAMETERS — shape, rim weight, frame colour, lens tint,
// where it sat on the face — instead of cutting its pixels out. The procedural model
// then draws a clean frame that resembles the photo and never smears.
//
// Pure: takes the SAM mask (Uint8Array, w*h) and the photo as ImageData-like
// { data:Uint8ClampedArray, width, height } at the SAME w*h, plus optional landmarks.

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const px = (img, x, y) => { const i = (y * img.width + x) * 4; return [img.data[i], img.data[i + 1], img.data[i + 2]]; };
const luma = c => (c[0] * 299 + c[1] * 587 + c[2] * 114) / 1000;
const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
const hex = c => '#' + c.map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
const median = xs => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : 0; };

function bbox(mask, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1, area = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    area++;
    const x = i % w, y = (i - x) / w;
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return x1 < 0 ? null : { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1, area };
}

/** The bridge is the column with the fewest frame pixels in the central third. */
function bridgeX(mask, w, b) {
  const yA = (b.y0 + b.h * 0.2) | 0, yB = (b.y0 + b.h * 0.8) | 0;
  const from = (b.x0 + b.w * 0.33) | 0, to = (b.x0 + b.w * 0.67) | 0;
  let bestX = (b.x0 + b.w / 2) | 0, bestCol = Infinity;
  for (let x = from; x <= to; x++) {
    let col = 0;
    for (let y = yA; y <= yB; y++) if (mask[y * w + x]) col++;
    if (col < bestCol) { bestCol = col; bestX = x; }
  }
  return bestX;
}

function subBox(mask, w, h, x0, x1) {
  let bx0 = x1, by0 = h, bx1 = -1, by1 = -1, area = 0;
  for (let y = 0; y < h; y++) for (let x = x0; x <= x1; x++) {
    if (!mask[y * w + x]) continue;
    area++;
    if (x < bx0) bx0 = x; if (x > bx1) bx1 = x;
    if (y < by0) by0 = y; if (y > by1) by1 = y;
  }
  return bx1 < 0 ? null : { x0: bx0, y0: by0, x1: bx1, y1: by1, w: bx1 - bx0 + 1, h: by1 - by0 + 1, area };
}

/** fill ratio, row widths, and how full the top corners are (cat-eye lifts one). */
function lensStats(mask, w, lb) {
  const rows = new Array(lb.h).fill(0);
  let area = 0;
  for (let y = lb.y0; y <= lb.y1; y++) for (let x = lb.x0; x <= lb.x1; x++)
    if (mask[y * w + x]) { area++; rows[y - lb.y0]++; }
  const at = f => rows[clamp(Math.round((lb.h - 1) * f), 0, lb.h - 1)] / lb.w;

  const cw = Math.max(3, (lb.w * 0.22) | 0), ch = Math.max(3, (lb.h * 0.22) | 0);
  const cornerFill = x0 => {
    let n = 0;
    for (let y = lb.y0; y < lb.y0 + ch; y++) for (let x = x0; x < x0 + cw; x++) if (mask[y * w + x]) n++;
    return n / (cw * ch);
  };
  const corner = Math.max(cornerFill(lb.x0), cornerFill(lb.x1 - cw + 1));

  return { fill: area / (lb.w * lb.h), aspect: lb.w / lb.h, top: at(0.1), mid: at(0.5), bot: at(0.88), corner };
}

function classify(s) {
  // outer-top corner filled while the lens is not a full box -> cat-eye
  if (s.fill > 0.82 && s.aspect > 1.05) return 'square';
  if (s.corner > 0.4 && s.fill < 0.78) return 'cat';
  return 'round';
}

/**
 * Ray-cast from the lens centre. Frame colour is sampled only from the lower two-thirds
 * of the rim — hair falls over the top, almost never the bottom — and the single darkest
 * cluster is dropped unless the frame really is black.
 */
function rim(mask, img, w, h, lb) {
  const cx = (lb.x0 + lb.w / 2) | 0, cy = (lb.y0 + lb.h / 2) | 0;
  const maxR = Math.max(lb.w, lb.h);
  const lowCols = [], allCols = [], runs = [];
  for (let a = 0; a < 48; a++) {
    const ang = (a / 48) * Math.PI * 2, dx = Math.cos(ang), dy = Math.sin(ang);
    let edge = -1;
    for (let r = 2; r < maxR; r++) {
      const x = Math.round(cx + dx * r), y = Math.round(cy + dy * r);
      if (x < 0 || y < 0 || x >= w || y >= h) break;
      if (mask[y * w + x]) edge = r;
    }
    if (edge < 5) continue;
    const ex = clamp(Math.round(cx + dx * edge), 0, w - 1), ey = clamp(Math.round(cy + dy * edge), 0, h - 1);
    const ec = px(img, ex, ey);
    allCols.push(ec);
    if (dy > -0.25) lowCols.push(ec);          // skip the top ~30° arc
    let run = 0;
    for (let r = edge; r > Math.max(1, edge - 40); r--) {
      const c = px(img, clamp(Math.round(cx + dx * r), 0, w - 1), clamp(Math.round(cy + dy * r), 0, h - 1));
      if (dist2(c, ec) < 45 * 45) run++; else break;
    }
    runs.push(run / edge);
  }

  let pool = lowCols.length >= 6 ? lowCols : allCols;
  // drop the darkest quarter unless the whole rim is dark (genuine black frame)
  const byLuma = [...pool].sort((p, q) => luma(p) - luma(q));
  const medianLuma = luma(byLuma[byLuma.length >> 1] || [60, 60, 60]);
  if (medianLuma > 55) pool = byLuma.slice(Math.floor(byLuma.length * 0.28));
  const src = pool.length ? pool : allCols;
  const frameColor = src.length
    ? hex([0, 1, 2].map(k => median(src.map(c => c[k]))))
    : '#3a3a3a';
  return { rimRatio: clamp(median(runs) || 0.08, 0.03, 0.22), frameColor };
}

/**
 * @returns {{ ok, shape, rim, frameColor, lensColor, spanRatio, yRatio, score }}
 *   `rim` is a 0.4–2.4 multiplier on the model's default rim weight.
 *   On a hopeless mask returns { ok:false } with sane defaults so the UI can still
 *   offer a manual pick.
 */
export function measureFrame(img, mask, w, h, landmarks) {
  const fallback = { ok: false, shape: 'round', rim: 1, frameColor: '#3a3a3a', lensColor: '#ffffff10', spanRatio: 1.55, yRatio: -0.05, score: 0 };

  const b = bbox(mask, w, h);
  if (!b) return fallback;
  const areaFrac = b.area / (w * h);
  const aspect = b.w / b.h;
  // a pair of glasses is a wide, short, not-too-big region
  const plausible = areaFrac > 0.004 && areaFrac < 0.6 && aspect > 1.4 && aspect < 6 && b.h > 8;
  if (!plausible) return fallback;

  const bx = landmarks ? Math.round(((landmarks[6] || landmarks[168]).x) * w) : bridgeX(mask, w, b);
  const left = subBox(mask, w, h, b.x0, clamp(bx - 1, b.x0, b.x1));
  const right = subBox(mask, w, h, clamp(bx + 1, b.x0, b.x1), b.x1);
  const lens = [left, right].filter(Boolean).sort((p, q) => q.area - p.area)[0] || b;

  const s = lensStats(mask, w, lens);
  const shape = classify(s);
  const { rimRatio, frameColor } = rim(mask, img, w, h, lens);

  // lens tint: what shows through the centre. dark => sunglasses, else treat as clear.
  const cc = px(img, clamp((lens.x0 + lens.w / 2) | 0, 0, w - 1), clamp((lens.y0 + lens.h / 2) | 0, 0, h - 1));
  const lensColor = luma(cc) < 78 ? hex(cc) + '99' : luma(cc) < 120 ? hex(cc) + '44' : '#ffffff10';

  // where it sat on the face
  let spanRatio = 1.55, yRatio = -0.05;
  if (landmarks) {
    const e = i => landmarks[i];
    const eyeSpan = Math.hypot((e(263).x - e(33).x) * w, (e(263).y - e(33).y) * h);
    const eyeMidY = (e(33).y + e(263).y) / 2 * h;
    if (eyeSpan > 1) {
      spanRatio = clamp(b.w / eyeSpan, 1.2, 2.1);
      yRatio = clamp(((b.y0 + b.h / 2) - eyeMidY) / eyeSpan, -0.28, 0.14);
    }
  }

  // rimRatio ~0.03 (wire) .. ~0.18 (chunky acetate); model default rim ≈ 0.06 of lens width
  const rimMul = clamp(rimRatio / 0.06, 0.4, 2.4);
  const score = clamp(1 - Math.abs(aspect - 2.6) / 3, 0.2, 1);

  return { ok: true, shape, rim: +rimMul.toFixed(2), frameColor, lensColor, spanRatio: +spanRatio.toFixed(2), yRatio: +yRatio.toFixed(3), score: +score.toFixed(2) };
}
