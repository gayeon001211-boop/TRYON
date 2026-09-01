// 2D render of a GlassesAsset — the front view.
// Draws the SAME regularised frame the 3D model builds (rims + bridge + temples),
// so switching 2D/3D shows one product rather than two different objects.
//
// The caller sets up the transform so 1 unit = frame width, origin = frame centre,
// canvas y pointing down. Asset polygons are y-up, so we flip y here.

import { eyewearSpec, polyFromProfile } from './eyewear.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// building the spec means a DFT per lens; the same asset is drawn every animation frame
const specCache = new Map();
function specOf(asset) {
  const key = asset.id || asset;
  let spec = specCache.get(key);
  if (!spec) { spec = eyewearSpec(asset); specCache.set(key, spec); }
  return spec;
}

/** Shrink a polygon toward its centroid by `d` model-units (for rim thickness). */
export function insetPoly(poly, d) {
  if (!d) return poly;
  let cx = 0, cy = 0;
  for (const [x, y] of poly) { cx += x; cy += y; }
  cx /= poly.length; cy /= poly.length;
  return poly.map(([x, y]) => {
    const dx = x - cx, dy = y - cy, len = Math.hypot(dx, dy) || 1;
    const k = Math.max(0, len - d) / len;
    return [cx + dx * k, cy + dy * k];
  });
}

/**
 * @param ctx        2D context, transform already applied (unit = frame width)
 * @param asset      GlassesAsset
 * @param opts       { frameColor, lensColor, lensOpacity, thickness, temples, yaw }
 */
export function drawAssetFront(ctx, asset, opts = {}) {
  const frameColor = opts.frameColor || asset.frameColor || '#222';
  const lensColor = opts.lensColor || asset.lensColor || '#ffffff';
  const lensOpacity = opts.lensOpacity ?? asset.lensOpacity ?? 0.12;
  const thickness = opts.thickness ?? 1;
  const showTemples = opts.temples !== false;
  const yaw = opts.yaw || 0;

  const spec = specOf(asset);
  const rimW = spec.rimW * thickness;
  const lens = polyFromProfile(spec.lensR, 0, 0);
  const outer = spec.rimProfile
    ? Array.from(spec.lensR, (r, i) => {              // typed-array .map would give NaN
        const ang = (Math.PI * 2 * i) / spec.n, d = r + spec.rimProfile[i] * thickness;
        return [Math.cos(ang) * d, Math.sin(ang) * d];
      })
    : polyFromProfile(spec.lensR, 0, 0, rimW);

  ctx.save();
  ctx.lineJoin = ctx.lineCap = 'round';

  if (showTemples) drawTemples(ctx, spec, frameColor, yaw);

  // rims: the ring between the lens opening and its outward offset
  ctx.fillStyle = frameColor;
  for (const sign of [-1, 1]) {
    const dx = sign * spec.halfGap, dy = spec.centreY;
    ctx.beginPath();
    addSub(ctx, outer.map(([x, y]) => [x + dx, y + dy]));
    addSub(ctx, lens.map(([x, y]) => [x + dx, y + dy]));
    ctx.fill('evenodd');
  }

  // end pieces: the wings out to the frame's real outer edge
  const e = spec.endPiece;
  for (const sign of [-1, 1]) {
    ctx.beginPath();
    const x0 = sign > 0 ? e.x - e.w / 2 : -(e.x + e.w / 2);
    ctx.roundRect(x0, -(e.y + e.h / 2), e.w, e.h, e.h * 0.4);
    ctx.fill();
  }

  // bridge: an arched bar between the rims
  const b = spec.bridge;
  ctx.strokeStyle = frameColor;
  ctx.lineWidth = b.thick;
  ctx.beginPath();
  ctx.moveTo(-b.span / 2 - rimW * 0.4, -b.y);
  ctx.quadraticCurveTo(0, -(b.y + b.arch * 1.4), b.span / 2 + rimW * 0.4, -b.y);
  ctx.stroke();

  // lens surfaces
  ctx.globalAlpha = clamp(lensOpacity, 0, 1);
  ctx.fillStyle = lensColor;
  for (const sign of [-1, 1]) {
    const dx = sign * spec.halfGap, dy = spec.centreY;
    ctx.beginPath();
    addSub(ctx, lens.map(([x, y]) => [x + dx, y + dy]));
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  ctx.restore();
}

function addSub(ctx, poly) {
  poly.forEach(([x, y], i) => { i ? ctx.lineTo(x, -y) : ctx.moveTo(x, -y); });
  ctx.closePath();
}

function drawTemples(ctx, spec, color, yaw) {
  const len = spec.templeLen * 0.5;                // front-view foreshortened
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(0.012, spec.rimW * 0.8);
  for (const sign of [-1, 1]) {
    // head-on a temple points away from the camera and is all but invisible
    const reach = len * Math.max(0, sign * yaw) * 1.6;
    if (reach < 0.03) continue;
    const hx = sign * spec.endPiece.x, hy = spec.endPiece.y;
    ctx.beginPath();
    ctx.moveTo(hx, -hy);
    ctx.quadraticCurveTo(hx + sign * reach, -hy, hx + sign * reach, -hy + spec.templeDrop * 0.5);
    ctx.stroke();
  }
}

/**
 * Place a GlassesAsset on a face and draw it (2D try-on).
 * pose: { cx, cy, eyeSpan, angle, yaw } in canvas px (mirrored for selfie view).
 * fit:  { w, h, x, y, scale, r }
 */
export function drawAssetAtPose(ctx, asset, pose, fit, opts, alpha = 1) {
  const span = pose.eyeSpan;
  const spanRatio = asset.placement?.spanRatio ?? 1.55;
  const yRatio = asset.placement?.yRatio ?? -0.05;
  const s = span * spanRatio * (fit.w ?? 1) * (fit.scale ?? 1);
  const squash = Math.max(0.5, 1 - Math.abs(pose.yaw ?? 0) * 1.4);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(pose.cx, pose.cy);
  ctx.rotate((pose.angle ?? 0) + (fit.r ?? 0) * Math.PI / 180);
  ctx.translate(
    span * ((pose.yaw ?? 0) * 0.1 + (fit.x ?? 0)),
    span * (yRatio + (fit.y ?? 0)),
  );
  ctx.scale(s * squash, s * (fit.h ?? 1));
  drawAssetFront(ctx, asset, { ...opts, yaw: pose.yaw ?? 0 });
  ctx.restore();
}

/** Small canvas thumbnail for the collection chip. */
export function assetThumb(asset, w = 176, h = 88) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.translate(w / 2, h / 2);
  ctx.scale(w * 0.9, w * 0.9);
  drawAssetFront(ctx, asset, { frameColor: '#f2f0eb', lensColor: '#000', lensOpacity: 0.05, temples: false });
  return c;
}
