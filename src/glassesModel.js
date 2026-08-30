// Build a 3D pair of glasses from a GlassesAsset by extruding its *traced* outline.
// No round/square/cat-eye presets — the silhouette and the lens openings are the ones
// pulled out of the uploaded photo.

import * as THREE from 'three';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function parseRGBA(hex) {
  const h = (hex || '#000000').replace('#', '');
  const rgb = h.slice(0, 6).padEnd(6, '0');
  const alpha = h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : null;
  return { color: new THREE.Color('#' + rgb), alpha };
}

function centroid(poly) {
  let x = 0, y = 0;
  for (const [px, py] of poly) { x += px; y += py; }
  return [x / poly.length, y / poly.length];
}
function insetPoly(poly, d) {
  if (!d) return poly;
  const [cx, cy] = centroid(poly);
  return poly.map(([x, y]) => {
    const dx = x - cx, dy = y - cy, len = Math.hypot(dx, dy) || 1;
    const k = Math.max(0.02, len - d) / len;
    return [cx + dx * k, cy + dy * k];
  });
}

function shapeFromPoly(poly) {
  const s = new THREE.Shape();
  poly.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  s.closePath();
  return s;
}
function pathFromPoly(poly) {
  const p = new THREE.Path();
  poly.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)));
  p.closePath();
  return p;
}

function lensSurface(poly, mat, z) {
  const geo = new THREE.ShapeGeometry(shapeFromPoly(poly), 16);
  const [cx, cy] = centroid(poly);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const dx = pos.getX(i) - cx, dy = pos.getY(i) - cy;
    pos.setZ(i, z + 0.03 * Math.max(0, 1 - (dx * dx + dy * dy) / 0.05));
  }
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, mat);
}

function templeMesh(hinge, sign, mat, dim, thickness) {
  const [hx, hy] = hinge;
  const len = dim.templeLen ?? 1.35;
  const drop = dim.templeDrop ?? 0.12;
  const r = clamp((dim.rimRatio ?? 0.09) * 0.6, 0.01, 0.05) * thickness;
  const pts = [
    new THREE.Vector3(hx, hy, 0.02),
    new THREE.Vector3(hx + sign * 0.02, hy, -0.14),
    new THREE.Vector3(hx + sign * 0.02, hy, -len * 0.72),
    new THREE.Vector3(hx + sign * 0.02, hy - drop * 0.6, -len * 0.9),
    new THREE.Vector3(hx + sign * 0.02, hy - drop, -len),
  ];
  const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 32, r, 6, false);
  return new THREE.Mesh(geo, mat);
}

/**
 * @param asset  GlassesAsset
 * @param opts   { frameColor, lensColor, lensOpacity, thickness, frameOpacity }
 * @returns THREE.Group  (name 'glasses', ~1 unit wide, origin at frame centre)
 */
export function buildGlassesFromAsset(asset, opts = {}) {
  const g = asset.geometry;
  const dim = asset.dimensions || {};
  const thickness = opts.thickness ?? 1;

  const frameColor = opts.frameColor || asset.frameColor || '#222';
  const lensSpec = parseRGBA(opts.lensColor || asset.lensColor || '#ffffff');
  const lensOpacity = clamp(opts.lensOpacity ?? asset.lensOpacity ?? 0.12, 0.02, 0.7);
  const frameOpacity = clamp(opts.frameOpacity ?? 1, 0.2, 1);

  const group = new THREE.Group();
  group.name = 'glasses';

  const frameMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(frameColor), roughness: 0.4, metalness: 0.25,
    transparent: frameOpacity < 1, opacity: frameOpacity,
  });
  const lensMat = new THREE.MeshStandardMaterial({
    color: lensSpec.color, transparent: true, opacity: lensOpacity,
    roughness: 0.08, metalness: 0.1, side: THREE.DoubleSide, depthWrite: false,
  });

  // thickness offsets the lens openings inward/outward; outline is untouched
  const rimInset = (thickness - 1) * (dim.rimRatio ?? 0.09) * 0.5;
  const lensL = insetPoly(g.lensL, rimInset);
  const lensR = insetPoly(g.lensR, rimInset);

  // frame: extrude the outline with the two openings as holes
  const shape = shapeFromPoly(g.outline);
  shape.holes = [pathFromPoly([...lensL].reverse()), pathFromPoly([...lensR].reverse())];
  const depth = clamp(dim.depth ?? 0.06, 0.02, 0.16) * thickness;
  const frameGeo = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: true, bevelThickness: depth * 0.25, bevelSize: depth * 0.2, bevelSegments: 2,
    curveSegments: 4,
  });
  frameGeo.translate(0, 0, -depth / 2);
  frameGeo.computeVertexNormals();
  group.add(new THREE.Mesh(frameGeo, frameMat));

  // lens surfaces sit just proud of the frame front
  group.add(lensSurface(lensL, lensMat, depth * 0.1));
  group.add(lensSurface(lensR, lensMat, depth * 0.1));

  // the real frame pixels, mapped onto the front face — the uploaded design, on 3D geometry
  if (asset.frontTexture && asset.textureBox && opts.texture !== false) {
    const decalShape = shapeFromPoly(g.outline);
    decalShape.holes = [pathFromPoly([...lensL].reverse()), pathFromPoly([...lensR].reverse())];
    const decalGeo = new THREE.ShapeGeometry(decalShape, 12);
    const tb = asset.textureBox, pos = decalGeo.attributes.position, uv = decalGeo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      uv.setXY(i, (pos.getX(i) - tb.x0) / tb.w, (pos.getY(i) - tb.y0) / tb.h);
    }
    uv.needsUpdate = true;
    const decalMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
    new THREE.TextureLoader().load(asset.frontTexture, tex => {
      tex.colorSpace = THREE.SRGBColorSpace;
      decalMat.map = tex; decalMat.needsUpdate = true;
    });
    const decal = new THREE.Mesh(decalGeo, decalMat);
    decal.position.z = depth / 2 + 0.004;
    decal.renderOrder = 3;
    group.add(decal);
    group.userData.decalMat = decalMat;
  }

  // temples
  group.add(templeMesh(g.hingeL, -1, frameMat, dim, thickness));
  group.add(templeMesh(g.hingeR, 1, frameMat, dim, thickness));

  group.userData.frameMat = frameMat;
  group.userData.lensMat = lensMat;
  group.userData.assetId = asset.id;
  return group;
}
