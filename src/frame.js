// Pure helpers for TRYON. No DOM, so they can be tested with node.

/** Face pose from the two outer eye-corner landmarks (already mirrored if the view is). */
export function poseFromEyes(a, b, w, h) {
  const ax = a.x * w, ay = a.y * h, bx = b.x * w, by = b.y * h;
  const dx = bx - ax, dy = by - ay;
  return {
    cx: (ax + bx) / 2,
    cy: (ay + by) / 2,
    angle: Math.atan2(dy, dx),
    eyeSpan: Math.hypot(dx, dy),
  };
}

/** Average of the 4 corner pixels — the assumed background colour of a product shot. */
export function sampleCorners(data, w, h) {
  const at = (x, y) => { const i = (y * w + x) * 4; return [data[i], data[i + 1], data[i + 2]]; };
  const c = [at(0, 0), at(w - 1, 0), at(0, h - 1), at(w - 1, h - 1)];
  return [0, 1, 2].map(k => Math.round(c.reduce((s, p) => s + p[k], 0) / 4));
}

/** Alpha-out every pixel within `tol` of `bg`. Returns how many pixels were cut. */
export function keyOut(data, bg, tol) {
  let cut = 0;
  const t2 = tol * tol * 3;
  for (let i = 0; i < data.length; i += 4) {
    const dr = data[i] - bg[0], dg = data[i + 1] - bg[1], db = data[i + 2] - bg[2];
    if (dr * dr + dg * dg + db * db <= t2) { data[i + 3] = 0; cut++; }
  }
  return cut;
}

/* ---------- canvas drawing (unit space: total frame width 1, centred on the eyes) ---------- */
function lensPath(ctx, shape, sx) {
  ctx.beginPath();
  if (shape === 'round') ctx.ellipse(sx * 0.28, 0, 0.2, 0.17, 0, 0, Math.PI * 2);
  else if (shape === 'square') ctx.roundRect(sx * 0.28 - 0.21, -0.15, 0.42, 0.3, 0.05);
  else { // cat-eye: outer top corner lifted
    const cx = sx * 0.28;
    ctx.moveTo(cx - sx * 0.21, -0.19);
    ctx.quadraticCurveTo(cx + sx * 0.21, -0.15, cx + sx * 0.2, -0.02);
    ctx.quadraticCurveTo(cx + sx * 0.15, 0.17, cx - sx * 0.05, 0.15);
    ctx.quadraticCurveTo(cx - sx * 0.22, 0.1, cx - sx * 0.21, -0.19);
  }
  ctx.closePath();
}

export function drawVector(ctx, shape, frameColor, lensColor) {
  ctx.lineWidth = 0.035; ctx.lineJoin = ctx.lineCap = 'round'; ctx.strokeStyle = frameColor;
  for (const sx of [-1, 1]) {
    lensPath(ctx, shape, sx);
    ctx.fillStyle = lensColor; ctx.fill(); ctx.stroke();
  }
  ctx.beginPath(); ctx.moveTo(-0.08, -0.05); ctx.quadraticCurveTo(0, -0.11, 0.08, -0.05); ctx.stroke();
  for (const sx of [-1, 1]) {
    ctx.beginPath(); ctx.moveTo(sx * 0.48, -0.1); ctx.lineTo(sx * 0.56, -0.06); ctx.stroke();
  }
}

// image frames are tinted through an offscreen cache so the tint stays inside the cut-out
const tintCache = new Map();
export function tinted(frame, color) {
  const key = frame.id + color;
  if (tintCache.has(key)) return tintCache.get(key);
  const src = frame.canvas, c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const x = c.getContext('2d');
  x.drawImage(src, 0, 0);
  x.globalCompositeOperation = 'source-atop';
  x.globalAlpha = 0.45; x.fillStyle = color; x.fillRect(0, 0, c.width, c.height);
  tintCache.set(key, c);
  return c;
}

/**
 * Draw one frame onto ctx at a face pose. `fit` = {w,h,y,r}.
 * spanRatio/yRatio come from the photo the frame was cut out of, so an extracted
 * frame lands at the size and height it had on that face.
 * ponytail: yaw only squashes the sprite horizontally — a real 3D frame would rotate.
 */
export function drawFrame(ctx, frame, pose, fit, frameColor, lensColor, alpha = 1) {
  const span = pose.eyeSpan;
  const s = span * (frame.spanRatio ?? 1.6) * fit.w;
  const yaw = Math.max(0.45, 1 - Math.abs(pose.yaw ?? 0) * 1.6);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(pose.cx, pose.cy);
  ctx.rotate(pose.angle + fit.r * Math.PI / 180);
  ctx.translate(span * (pose.yaw ?? 0) * 0.12, span * ((frame.yRatio ?? 0) + fit.y));
  ctx.scale(s * yaw, s * fit.h);
  if (frame.canvas) {
    const img = tinted(frame, frameColor), ar = img.height / img.width;
    ctx.drawImage(img, -0.5, -ar / 2, 1, ar);
  } else {
    drawVector(ctx, frame.shape, frameColor, lensColor);
  }
  ctx.restore();
}

/** Crop a rect out of an image element and knock out its background. */
export function extractFrame(img, sel, tol) {
  const c = document.createElement('canvas');
  c.width = Math.round(sel.w); c.height = Math.round(sel.h);
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(img, sel.x, sel.y, sel.w, sel.h, 0, 0, c.width, c.height);
  const data = x.getImageData(0, 0, c.width, c.height);
  keyOut(data.data, sampleCorners(data.data, c.width, c.height), tol);
  x.putImageData(data, 0, 0);
  return c;
}
