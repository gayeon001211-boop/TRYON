// Build a wearable 3D pair of glasses from a GlassesAsset.
// The traced silhouette is a MEASUREMENT, not the shape: eyewear.js turns it into a
// symmetric lens profile plus dimensions, and this file builds a real frame from those
// — two rims, a bridge, end pieces, hinged temples, wrap, acetate and glass.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { eyewearSpec, polyFromProfile } from './eyewear.js';
import { materialParams } from './material.js';

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

/**
 * A lens, not a flat disc: real lenses carry a base curve, so the surface bows forward
 * at the centre and flattens to the rim. The bulge is relative to the lens itself —
 * the old fixed divisor folded the surface in on small lenses.
 */
function lensSurface(poly, mat, z, bulge = 0.02) {
  const geo = new THREE.ShapeGeometry(shapeFromPoly(poly), 24);
  const [cx, cy] = centroid(poly);
  const pos = geo.attributes.position;
  let rMax = 1e-6;
  for (let i = 0; i < pos.count; i++) {
    rMax = Math.max(rMax, Math.hypot(pos.getX(i) - cx, pos.getY(i) - cy));
  }
  for (let i = 0; i < pos.count; i++) {
    const r = Math.hypot(pos.getX(i) - cx, pos.getY(i) - cy) / rMax;
    pos.setZ(i, z + bulge * (1 - r * r));          // spherical cap, flat at the rim
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat); m.name = 'lens'; return m;
}

/** Rounded-rectangle cross-section: temples are flat blades, not round rods. */
function bladeShape(halfW, halfH) {
  const s = new THREE.Shape(), r = Math.min(halfW, halfH) * 0.8;
  s.moveTo(-halfW + r, -halfH);
  s.lineTo(halfW - r, -halfH); s.quadraticCurveTo(halfW, -halfH, halfW, -halfH + r);
  s.lineTo(halfW, halfH - r); s.quadraticCurveTo(halfW, halfH, halfW - r, halfH);
  s.lineTo(-halfW + r, halfH); s.quadraticCurveTo(-halfW, halfH, -halfW, halfH - r);
  s.lineTo(-halfW, -halfH + r); s.quadraticCurveTo(-halfW, -halfH, -halfW + r, -halfH);
  return s;
}

/**
 * A temple: a blade extruded along the hinge → ear path, tapering towards the tip and
 * curling down behind the ear. The uploaded photo is a front view, so the path is an
 * estimate — but a flat, tapered, hooked one reads as an arm instead of a pipe.
 * ponytail: front-only source; a side photo would let us trace the real profile.
 */
function templeMesh(hinge, sign, mat, dim, thickness) {
  const [hx, hy] = hinge;
  const len = dim.templeLen ?? 1.05;
  const drop = dim.templeDrop ?? 0.12;
  const halfH = clamp((dim.rimRatio ?? 0.09) * 0.62, 0.020, 0.050) * thickness;
  const halfW = halfH * 0.38;

  const path = new THREE.CatmullRomCurve3([
    new THREE.Vector3(hx, hy, 0.03),
    new THREE.Vector3(hx + sign * 0.012, hy - drop * 0.04, -0.10),
    new THREE.Vector3(hx + sign * 0.016, hy - drop * 0.14, -len * 0.58),
    new THREE.Vector3(hx + sign * 0.014, hy - drop * 0.38, -len * 0.86),
    new THREE.Vector3(hx + sign * 0.008, hy - drop * 0.85, -len * 1.00),   // over the ear
    new THREE.Vector3(hx + sign * 0.002, hy - drop * 1.25, -len * 0.95),   // short hook behind it
  ]);

  const geo = new THREE.ExtrudeGeometry(bladeShape(halfW, halfH), {
    extrudePath: path, steps: 60, bevelEnabled: false, curveSegments: 8,
  });

  // ponytail: no taper. Deriving the curve parameter from z folded the blade back over
  // the lens near the hinge, and plenty of real temples are a constant section anyway.
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat); m.name = 'temple'; return m;
}


/** An arc of the lens rim as a tube, from angle a0 to a1 (radians, 0 = outward). */
function arcTube(spec, a0, a1, radius, mat, name) {
  const pts = [];
  const steps = Math.max(12, Math.round((spec.n * (a1 - a0)) / (Math.PI * 2)));
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    const bin = Math.min(spec.n - 1, Math.round((((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * spec.n) % spec.n);
    const r = spec.lensR[bin] + (spec.rimProfile ? spec.rimProfile[bin] : spec.rimW) * 0.5;
    pts.push(new THREE.Vector3(Math.cos(a) * r, spec.centreY + Math.sin(a) * r, 0));
  }
  const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length * 2, radius, 8, false);
  const m = new THREE.Mesh(geo, mat); m.name = name; return m;
}

/** A wire rim: a metal frame is a bent rod, not a slab with a hole in it. */
function wireRim(spec, mat) {
  const pts = polyFromProfile(spec.lensR, 0, spec.centreY, spec.rimW * 0.5)
    .map(([x, y]) => new THREE.Vector3(x, y, 0));
  const curve = new THREE.CatmullRomCurve3(pts, true);
  const r = clamp(spec.rimW * 0.34, 0.004, 0.014);      // ~1 mm of wire on a 140 mm front
  const geo = new THREE.TubeGeometry(curve, Math.max(64, spec.n), r, 8, true);
  const m = new THREE.Mesh(geo, mat); m.name = 'rim'; return m;
}

/** A rim: the lens opening cut out of an outward offset of itself, extruded and rounded. */
function rimMesh(spec, cx, mat) {
  const inner = polyFromProfile(spec.lensR, 0, 0);
  // rimProfile carries the thickness per angle, so a frame that is heavy on top and
  // fine underneath stays that way instead of becoming a uniform band
  // Array.from, not lensR.map — lensR is a Float64Array and .map on one coerces each
  // [x, y] back to a number, which quietly fills the polygon with NaN
  const outer = spec.rimProfile
    ? Array.from(spec.lensR, (r, i) => {
        const a = (Math.PI * 2 * i) / spec.n;
        const d = r + spec.rimProfile[i];
        return [Math.cos(a) * d, Math.sin(a) * d];
      })
    : polyFromProfile(spec.lensR, 0, 0, spec.rimW);
  const shape = shapeFromPoly(outer);
  shape.holes = [pathFromPoly([...inner].reverse())];
  const d = spec.depth;
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: d, bevelEnabled: true, bevelThickness: d * 0.2, bevelSize: spec.rimW * 0.14,
    bevelSegments: 3, curveSegments: 6,
  });
  // (angle, band) UVs so the unwrapped rim strip lands on the rebuilt ring, whatever
  // regularising did to the outline
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  if (uv) {
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i);
      const a = (Math.atan2(y, x) + Math.PI * 2) % (Math.PI * 2);
      const bin = Math.min(spec.n - 1, Math.round((a / (Math.PI * 2)) * spec.n) % spec.n);
      const r = Math.hypot(x, y), r0 = spec.lensR[bin];
      const band = (spec.rimProfile ? spec.rimProfile[bin] : spec.rimW) || 1e-6;
      uv.setXY(i, a / (Math.PI * 2), clamp((r - r0) / band, 0, 1));
    }
    uv.needsUpdate = true;
  }
  geo.translate(cx, spec.centreY, -d / 2);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat); m.name = 'rim'; return m;
}

/** The bridge: an arched bar between the two rims, same section as the rim. */
function bridgeMesh(spec, mat) {
  const b = spec.bridge, half = b.span / 2, t = b.thick / 2;
  const path = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-half - spec.rimW * 0.4, b.y, 0),
    new THREE.Vector3(-half * 0.5, b.y + b.arch * 0.8, 0.004),
    new THREE.Vector3(0, b.y + b.arch, 0.006),
    new THREE.Vector3(half * 0.5, b.y + b.arch * 0.8, 0.004),
    new THREE.Vector3(half + spec.rimW * 0.4, b.y, 0),
  ]);
  const geo = new THREE.ExtrudeGeometry(bladeShape(spec.depth * 0.45, t), {
    extrudePath: path, steps: 40, bevelEnabled: false, curveSegments: 8,
  });
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat); m.name = 'bridge'; return m;
}

/** End piece: the little block that carries the hinge, out at the temple side of a rim. */
function endPieceMesh(spec, sign, mat) {
  const e = spec.endPiece;
  // a rounded slab reaching out to the frame's real outer edge, angled back a little
  const geo = new THREE.ExtrudeGeometry(bladeShape(e.w / 2, e.h / 2), {
    depth: spec.depth * 0.9, bevelEnabled: true, bevelThickness: spec.depth * 0.15,
    bevelSize: e.h * 0.12, bevelSegments: 2, curveSegments: 6,
  });
  geo.translate(sign * e.x, e.y, -spec.depth * 0.45);
  const m = new THREE.Mesh(geo, mat); m.name = 'endPiece'; return m;
}

/**
 * Build a wearable frame from the measurements of the uploaded one.
 * The silhouette that was traced off the photo drives every dimension here, but the
 * result is symmetric, has a real bridge, end pieces and hinged temples, and rounded
 * mouldable sections — something a person could actually put on.
 */
function buildWearable(asset, opts, mats) {
  const { frameMat, lensMat } = mats;
  const spec0 = eyewearSpec(asset);
  const mp0 = materialParams(spec0.material || 'acetate');
  const spec = mp0.depthScale === 1 ? spec0 : { ...spec0, depth: spec0.depth * mp0.depthScale };
  const group = new THREE.Group();
  group.name = 'glasses';

  // a real lens is seated in a groove: cut it slightly larger than the opening so its
  // edge tucks under the rim, otherwise the rim's inner wall shows through the tint
  const lensPoly = polyFromProfile(spec.lensR, 0, 0, spec.rimW * 0.3);

  const build = spec.construction || 'fullrim';
  for (const sign of [-1, 1]) {
    // One group per eye, wrapped back towards the face. The end piece and the arm live
    // INSIDE it — parented to the frame instead they stayed flat while the rim turned,
    // and tore away from it into floating chunks.
    const eye = new THREE.Group();
    // rimless drills the lens straight to the bridge; a browline carries material only
    // across the top. Building every frame as a full rim erased both.
    if (build === 'wire') {
      eye.add(wireRim(spec, frameMat));
    } else if (build === 'browline') {
      // heavy brow over the lens, fine wire under it — the style itself, not a full rim
      eye.add(arcTube(spec, 0.12, Math.PI - 0.12, spec.rimW * 0.55, frameMat, 'rim'));
      eye.add(arcTube(spec, Math.PI + 0.05, Math.PI * 2 - 0.05, spec.rimW * 0.16, frameMat, 'rim'));
    } else if (build !== 'rimless') {
      eye.add(rimMesh(spec, 0, frameMat));
    }

    const lens = lensSurface(lensPoly, lensMat, 0, spec.lensW * 0.07);   // base curve
    lens.position.set(0, spec.centreY, 0);
    eye.add(lens);

    const local = { ...spec, endPiece: { ...spec.endPiece, x: spec.endPiece.x - spec.halfGap } };
    eye.add(endPieceMesh(local, sign, frameMat));
    const hinge = [
      sign * (local.endPiece.x + local.endPiece.w * 0.35),
      local.endPiece.y - local.endPiece.h * 0.15,
    ];
    eye.add(templeMesh(hinge, sign, frameMat, {
      templeLen: spec.templeLen, templeDrop: spec.templeDrop, rimRatio: spec.rimW * 1.6,
    }, opts.thickness ?? 1));

    eye.position.x = sign * spec.halfGap;
    eye.rotation.y = -sign * spec.wrap;
    group.add(eye);
  }

  if (spec.bridge.needed) group.add(bridgeMesh(spec, frameMat));
  return group;
}

/**
 * A normal map from the strip's own shading. A front photo carries no depth, but the
 * light and shade painted on the frame do describe its surface.
 * ponytail: shading-as-height is an illusion, not a measurement.
 */
function reliefFrom(image, strength = 2) {
  const w = image.width, h = image.height;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);
  const src = ctx.getImageData(0, 0, w, h).data;
  const lum = new Float32Array(w * h);
  for (let i = 0, p = 0; i < src.length; i += 4, p++) {
    lum[p] = src[i + 3] < 8 ? 0.5 : (src[i] * 0.299 + src[i + 1] * 0.587 + src[i + 2] * 0.114) / 255;
  }
  const at = (x, y) => lum[Math.min(h - 1, Math.max(0, y)) * w + ((x + w) % w)];   // u wraps
  const out = ctx.createImageData(w, h), o = out.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const gx = at(x + 1, y) - at(x - 1, y), gy = at(x, y + 1) - at(x, y - 1);
    const nx = -gx * strength, ny = -gy * strength, len = Math.hypot(nx, ny, 1), i = (y * w + x) * 4;
    o[i] = (nx / len * 0.5 + 0.5) * 255;
    o[i + 1] = (ny / len * 0.5 + 0.5) * 255;
    o[i + 2] = (1 / len * 0.5 + 0.5) * 255;
    o[i + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

/**
 * A small studio to reflect. Acetate gloss and lens glass are *reflections*: with lights
 * alone, clearcoat and transmission render nothing and every frame looks like clay.
 * One PMREM per renderer, cached.
 */
const envCache = new WeakMap();
export function studioEnvironment(renderer) {
  let tex = envCache.get(renderer);
  if (!tex) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    tex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    envCache.set(renderer, tex);
  }
  return tex;
}

export function buildGlassesFromAsset(asset, opts = {}) {
  const frameColor = opts.frameColor || asset.frameColor || '#222';
  const lensSpec = parseRGBA(opts.lensColor || asset.lensColor || '#ffffff');
  const lensOpacity = clamp(opts.lensOpacity ?? asset.lensOpacity ?? 0.12, 0.02, 0.7);
  const frameOpacity = clamp(opts.frameOpacity ?? 1, 0.2, 1);

  // shade it as what it is: polished metal, clear acetate, tortoiseshell or solid acetate.
  // One material for everything is why a wire frame used to look like moulded plastic.
  const mp = materialParams(asset.spec?.material || asset.material?.kind || 'acetate');
  const frameMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(frameColor),
    roughness: mp.roughness, metalness: mp.metalness,
    clearcoat: mp.clearcoat, clearcoatRoughness: mp.clearcoatRoughness,
    transmission: mp.transmission ?? 0, ior: mp.ior ?? 1.5,
    thickness: mp.thickness ?? 0,
    envMapIntensity: mp.metalness > 0.5 ? 1.6 : 1.1, sheen: mp.metalness > 0.5 ? 0 : 0.15,
    transparent: frameOpacity < 1, opacity: frameOpacity,
  });

  // the frame's own pixels, if we unwrapped them. Patterned frames need it (tortoiseshell
  // is not one colour); a plain moulded colour only gains noise, so it stays opt-in.
  const wantTex = opts.texture ?? (asset.material?.kind === 'patterned');
  if (wantTex && asset.rimTexture) {
    new THREE.TextureLoader().load(asset.rimTexture, tex => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = THREE.RepeatWrapping;
      tex.anisotropy = 8;
      frameMat.map = tex;
      try { frameMat.normalMap = reliefFrom(tex.image, 2); frameMat.normalScale = new THREE.Vector2(0.7, 0.7); }
      catch { /* relief is a nicety */ }
      frameMat.needsUpdate = true;
      opts.onReady?.();
    });
  }
  // real lens glass: transmissive with a tint, so it refracts and catches highlights
  const lensMat = new THREE.MeshPhysicalMaterial({
    color: lensSpec.color, transparent: true, opacity: clamp(lensOpacity + 0.35, 0.3, 0.95),
    transmission: clamp(1 - lensOpacity * 1.2, 0.25, 0.92), ior: 1.52, thickness: 0.05,
    roughness: 0.03, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03,
    side: THREE.DoubleSide, depthWrite: false,
  });

  const group = buildWearable(asset, opts, { frameMat, lensMat });
  group.userData.frameMat = frameMat;
  group.userData.lensMat = lensMat;
  group.userData.assetId = asset.id;
  return group;
}
