// Build a wearable 3D pair of glasses from a GlassesAsset.
// The traced silhouette is a MEASUREMENT, not the shape: eyewear.js turns it into a
// symmetric lens profile plus dimensions, and this file builds a real frame from those
// — two rims, a bridge, end pieces, hinged temples, wrap, acetate and glass.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { eyewearSpec, polyFromProfile } from './eyewear.js';

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

function lensSurface(poly, mat, z, bulge = 0.02) {
  const geo = new THREE.ShapeGeometry(shapeFromPoly(poly), 16);
  const [cx, cy] = centroid(poly);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const dx = pos.getX(i) - cx, dy = pos.getY(i) - cy;
    pos.setZ(i, z + bulge * Math.max(0, 1 - (dx * dx + dy * dy) / 0.05));
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


/** A rim: the lens opening cut out of an outward offset of itself, extruded and rounded. */
function rimMesh(spec, cx, mat) {
  const inner = polyFromProfile(spec.lensR, 0, 0);
  const outer = polyFromProfile(spec.lensR, 0, 0, spec.rimW);
  const shape = shapeFromPoly(outer);
  shape.holes = [pathFromPoly([...inner].reverse())];
  const d = spec.depth;
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: d, bevelEnabled: true, bevelThickness: d * 0.2, bevelSize: spec.rimW * 0.14,
    bevelSegments: 3, curveSegments: 6,
  });
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
  const spec = eyewearSpec(asset);
  const group = new THREE.Group();
  group.name = 'glasses';

  // a real lens is seated in a groove: cut it slightly larger than the opening so its
  // edge tucks under the rim, otherwise the rim's inner wall shows through the tint
  const lensPoly = polyFromProfile(spec.lensR, 0, 0, spec.rimW * 0.3);

  for (const sign of [-1, 1]) {
    // One group per eye, wrapped back towards the face. The end piece and the arm live
    // INSIDE it — parented to the frame instead they stayed flat while the rim turned,
    // and tore away from it into floating chunks.
    const eye = new THREE.Group();
    eye.add(rimMesh(spec, 0, frameMat));

    const lens = lensSurface(lensPoly, lensMat, 0, 0);
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

  const frameMat = new THREE.MeshPhysicalMaterial({
    // acetate: soft body, glossy surface. Metalness made every frame look like grey plastic.
    color: new THREE.Color(frameColor), roughness: 0.28, metalness: 0,
    clearcoat: 1, clearcoatRoughness: 0.09, envMapIntensity: 1.1, sheen: 0.15,
    transparent: frameOpacity < 1, opacity: frameOpacity,
  });
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
