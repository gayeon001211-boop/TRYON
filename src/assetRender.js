// 2D render of a GlassesAsset — the front view.
// When the asset carries `frontTexture` (the real frame pixels, cut to the frame
// shape), that is drawn on top of the geometry so the uploaded design shows; the
// flat fill is the fallback (presets, or while the texture decodes).
//
// The caller sets up the transform so 1 unit = frame width, origin = frame centre,
// canvas y pointing down. Asset polygons are y-up, so we flip y here.

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const texCache = new Map();
function texImg(url) {
  if (!url) return null;
  let e = texCache.get(url);
  if (!e) {
    e = { img: new Image(), ready: false };
    e.img.onload = () => { e.ready = true; };
    e.img.src = url;
    texCache.set(url, e);
  }
  return e.ready ? e.img : null;
}

function path(ctx, poly, flipY = true) {
  ctx.beginPath();
  poly.forEach(([x, y], i) => {
    const py = flipY ? -y : y;
    i ? ctx.lineTo(x, py) : ctx.moveTo(x, py);
  });
  ctx.closePath();
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
  const g = asset.geometry;
  const frameColor = opts.frameColor || asset.frameColor || '#222';
  const lensColor = opts.lensColor || asset.lensColor || '#ffffff';
  const lensOpacity = opts.lensOpacity ?? asset.lensOpacity ?? 0.12;
  const thickness = opts.thickness ?? 1;
  const showTemples = opts.temples !== false;
  const yaw = opts.yaw || 0;

  // thickness moves the lens openings in/out; the outer outline never changes
  const baseRim = (asset.dimensions?.rimRatio ?? 0.09);
  const d = (thickness - 1) * baseRim * 0.55;
  const lensL = insetPoly(g.lensL, d);
  const lensR = insetPoly(g.lensR, d);

  const tImg = opts.texture !== false ? texImg(asset.frontTexture) : null;
  const tb = asset.textureBox;

  ctx.save();
  ctx.lineJoin = ctx.lineCap = 'round';

  if (showTemples) drawTemples(ctx, g, frameColor, baseRim, yaw, asset.dimensions);

  if (tImg && tb) {
    // the real frame pixels, already cut to the frame shape when the asset was built
    ctx.drawImage(tImg, tb.x0, -(tb.y0 + tb.h), tb.w, tb.h);
  } else {
    // fallback: flat frame = outline minus the two lens holes (even-odd)
    ctx.beginPath();
    addSub(ctx, g.outline);
    addSub(ctx, lensL);
    addSub(ctx, lensR);
    ctx.fillStyle = frameColor;
    ctx.fill('evenodd');
    ctx.lineWidth = Math.max(0.004, baseRim * 0.12);
    ctx.strokeStyle = frameColor;
    path(ctx, g.outline); ctx.stroke();
  }

  // lens surfaces
  ctx.globalAlpha = clamp(lensOpacity, 0, 1);
  ctx.fillStyle = lensColor;
  path(ctx, lensL); ctx.fill();
  path(ctx, lensR); ctx.fill();
  ctx.globalAlpha = 1;

  ctx.restore();
}

function addSub(ctx, poly) {
  poly.forEach(([x, y], i) => { i ? ctx.lineTo(x, -y) : ctx.moveTo(x, -y); });
  ctx.closePath();
}

function drawTemples(ctx, g, color, baseRim, yaw, dim) {
  const len = (dim?.templeLen ?? 1.35) * 0.5;      // front-view foreshortened
  const drop = dim?.templeDrop ?? 0.12;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(0.012, baseRim * 0.7);
  for (const [hinge, sign] of [[g.hingeL, -1], [g.hingeR, 1]]) {
    // head-on, a temple points away from the camera and is all but invisible; the old
    // 0.28 baseline drew it as a bar sticking out sideways from the front view
    const reach = len * Math.max(0, sign * yaw) * 1.6;
    if (reach < 0.03) continue;
    const [hx, hy] = hinge;
    ctx.beginPath();
    ctx.moveTo(hx, -hy);
    ctx.quadraticCurveTo(hx + sign * reach, -hy, hx + sign * reach, -hy + drop * 0.5);
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
