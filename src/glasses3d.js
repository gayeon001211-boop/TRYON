// A real 3D pair of glasses, tracked onto the face.
//
// Placement is a hybrid: the 2D landmark solve (eye-corner midpoint, eye span, roll)
// still anchors the model in screen space — that part is rock solid — while yaw/pitch
// from the landmarks rotate the actual 3D geometry. So the frame has depth, the temples
// run back past the ears, and a face-shaped depth mask hides whatever turns behind the head.

import * as THREE from 'three';
import { FACE_OVAL, ovalFanIndex } from './faceMesh.js';

export { eulerFromLandmarks } from './frame.js';   // re-export so existing imports keep working

const CAM_FOV = 40;          // vertical, degrees
const CAM_DIST = 6;          // camera sits here on +Z, glasses at origin

/* ---------- geometry ---------- */

// lens outlines in a unit-ish space (frame half-width ~ 0.5), one side; mirror for the other
function lensOutline(shape) {
  const p = new THREE.Path();
  if (shape === 'square') {
    p.moveTo(-0.20, -0.15); p.lineTo(0.20, -0.15);
    p.lineTo(0.20, 0.15); p.lineTo(-0.20, 0.15); p.closePath();
  } else if (shape === 'cat') {
    p.moveTo(-0.21, 0.16); p.quadraticCurveTo(0.06, 0.20, 0.22, 0.13);
    p.quadraticCurveTo(0.20, -0.10, 0.02, -0.15);
    p.quadraticCurveTo(-0.18, -0.13, -0.21, 0.16);
  } else { // round
    for (let i = 0; i <= 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      const x = Math.cos(a) * 0.21, y = Math.sin(a) * 0.18;
      i ? p.lineTo(x, y) : p.moveTo(x, y);
    }
  }
  return p.getPoints(48);
}

function rimMesh(points2d, mat) {
  const curve = new THREE.CatmullRomCurve3(
    points2d.map(pt => new THREE.Vector3(pt.x, pt.y, 0)), true);
  const geo = new THREE.TubeGeometry(curve, 96, 0.018, 8, true);
  return new THREE.Mesh(geo, mat);
}

function lensMesh(points2d, mat) {
  const shape = new THREE.Shape(points2d.map(pt => new THREE.Vector2(pt.x, pt.y)));
  const geo = new THREE.ShapeGeometry(shape, 24);
  // bow the lens forward a touch
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    pos.setZ(i, 0.03 * Math.max(0, 1 - (x * x + y * y) / 0.09));
  }
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, mat);
}

function templeMesh(side, mat) {
  // hinge at the outer rim, run straight back along -Z, then drop behind the ear
  const s = side;
  const pts = [
    new THREE.Vector3(s * 0.50, 0.09, 0.0),
    new THREE.Vector3(s * 0.52, 0.09, -0.14),
    new THREE.Vector3(s * 0.52, 0.08, -0.46),
    new THREE.Vector3(s * 0.52, 0.02, -0.56),
    new THREE.Vector3(s * 0.52, -0.10, -0.58),
  ];
  const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.016, 6, false);
  return new THREE.Mesh(geo, mat);
}

/**
 * Build the glasses group. `silhouette` (optional HTMLCanvasElement, transparent PNG of a
 * real extracted frame) becomes a front decal so the true texture/logo/colour shows.
 */
export function buildGlasses({ shape = 'round', silhouette = null, frameColor = '#111', lensColor = '#ffffff10' }) {
  const g = new THREE.Group();
  g.name = 'glasses';

  const frameMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(frameColor), roughness: 0.35, metalness: 0.2 });
  const { color: lc, alpha: lensAlpha } = parseRGBA(lensColor);
  const lensMat = new THREE.MeshStandardMaterial({
    color: lc, transparent: true,
    opacity: clamp(lensAlpha * 0.85, 0.05, 0.6),   // never a solid disc
    roughness: 0.08, metalness: 0.1, side: THREE.DoubleSide,
    depthWrite: false,
  });

  const base = lensOutline(shape);
  for (const s of [-1, 1]) {
    const pts = base.map(p => ({ x: p.x + s * 0.30, y: p.y }));
    g.add(rimMesh(pts, frameMat));
    const lens = lensMesh(pts, lensMat);
    g.add(lens);
    g.add(templeMesh(s, frameMat));
  }

  // bridge
  const bridge = new THREE.Mesh(
    new THREE.CylinderGeometry(0.016, 0.016, 0.22, 8),
    frameMat);
  bridge.rotation.z = Math.PI / 2;
  bridge.position.y = 0.07;
  g.add(bridge);

  if (silhouette) {
    const tex = new THREE.CanvasTexture(silhouette);
    tex.colorSpace = THREE.SRGBColorSpace;
    const ar = silhouette.height / silhouette.width;
    const decalW = 1.06;
    const decal = new THREE.Mesh(
      new THREE.PlaneGeometry(decalW, decalW * ar),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    decal.position.z = 0.005;
    decal.renderOrder = 2;
    g.add(decal);
    g.userData.decal = decal;
  }

  g.userData.frameMat = frameMat;
  g.userData.lensMat = lensMat;
  return g;
}

/* ---------- the tracked layer ---------- */

export class Glasses3DLayer {
  constructor(canvas) {
    // preserveDrawingBuffer so snapshot() can read the frame back after compositing
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(CAM_FOV, 1, 0.1, 100);
    this.camera.position.set(0, 0, CAM_DIST);
    this.camera.lookAt(0, 0, 0);

    this.scene.add(new THREE.AmbientLight(0xffffff, 1.4));
    const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(1, 1, 2);
    const rim = new THREE.DirectionalLight(0x99bbff, 0.5); rim.position.set(-1, 0.5, -1);
    this.scene.add(key, rim);

    this.pivot = new THREE.Group();      // holds the glasses, gets the pose
    this.scene.add(this.pivot);
    this.glasses = null;

    // depth-only face mask so the head occludes whatever swings behind it
    this.occluder = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({ colorWrite: false }));
    this.occluder.renderOrder = -1;
    this.occ = new Float32Array(469 * 3);          // 468 landmarks + 1 centroid
    this.occluder.geometry.setAttribute('position', new THREE.BufferAttribute(this.occ, 3));
    this.occluder.geometry.setIndex(ovalFanIndex(468));
    this.scene.add(this.occluder);

    this.w = this.h = 1;
  }

  setGlasses(spec) {
    if (this.glasses) { this.pivot.remove(this.glasses); disposeTree(this.glasses); }
    this.glasses = buildGlasses(spec);
    this.pivot.add(this.glasses);
    this._spec = spec;
  }

  setColors(frameColor, lensColor) {
    if (!this.glasses || !this._spec) return;
    if (frameColor === this._spec.frameColor && lensColor === this._spec.lensColor) return;
    this.setGlasses({ ...this._spec, frameColor, lensColor });
  }

  resize(w, h) {
    this.w = w; this.h = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // world units per screen pixel at z=0
  _unitPerPx() {
    const worldH = 2 * CAM_DIST * Math.tan((CAM_FOV * Math.PI / 180) / 2);
    return worldH / this.h;
  }

  /**
   * pose: { cx, cy, eyeSpan, angle } in canvas px (already mirrored for selfie view)
   * euler: { yaw, pitch } radians   ·   fit: {w,h,y,r}   ·   worn: 0..1 ease
   * landmarks: mirrored [{x,y,z}] normalised, for the occluder (optional)
   */
  update(pose, euler, fit, frameColor, lensColor, worn, landmarks) {
    if (!this.glasses) return;
    this.setColors(frameColor, lensColor);

    const upp = this._unitPerPx();
    const spanRatio = this._spec.spanRatio ?? 1.6;
    const targetW = pose.eyeSpan * spanRatio * fit.w * upp;   // world width the model should span
    this.glasses.scale.setScalar(targetW / 1.0);              // model built ~1.0 wide
    this.glasses.scale.y *= fit.h;

    // screen (cx,cy) -> world at z=0. Push the frame forward of the eyes so it clears
    // the face depth-mask and reads as sitting on the nose, not embedded in it.
    const wx = (pose.cx - this.w / 2) * upp;
    const wy = -(pose.cy - this.h / 2) * upp;
    // yRatio only means something for a frame cut from a photo; the procedural model is
    // already centred on the eye line.
    const yRatio = this.glasses.userData.decal ? (this._spec.yRatio ?? 0) : 0.05;   // sit on the nose, not the brow
    const forward = pose.eyeSpan * upp * 0.18;                    // frame sits ~a finger's width off the eyes
    this.pivot.position.set(wx, wy - (yRatio + fit.y) * pose.eyeSpan * upp, forward);

    const ease = worn;
    this.pivot.rotation.set(
      (euler.pitch || 0) * ease,
      (euler.yaw || 0) * ease,
      -(pose.angle + fit.r * Math.PI / 180) * ease,
    );
    this.glasses.visible = ease > 0.02;
    // ease in by growing + a small forward settle, staying in front of the mask throughout
    const grow = 0.55 + 0.45 * ease;
    this.glasses.scale.multiplyScalar(grow);
    this.glasses.position.z = (1 - ease) * 0.6;

    // occluder — place the oval landmarks (+ their centroid) in the same screen-anchored space
    if (landmarks && landmarks.length >= 468) {
      const depth = pose.eyeSpan * upp * 2.2;
      const toWorld = p => [
        (p.x * this.w - this.w / 2) * upp,
        -(p.y * this.h - this.h / 2) * upp,
        -p.z * depth,
      ];
      for (let i = 0; i < 468; i++) {
        const [x, y, z] = toWorld(landmarks[i]);
        this.occ[i * 3] = x; this.occ[i * 3 + 1] = y; this.occ[i * 3 + 2] = z;
      }
      let cx = 0, cy = 0, cz = 0;
      for (const k of FACE_OVAL) { const [x, y, z] = toWorld(landmarks[k]); cx += x; cy += y; cz += z; }
      const n = FACE_OVAL.length;
      this.occ[468 * 3] = cx / n; this.occ[468 * 3 + 1] = cy / n; this.occ[468 * 3 + 2] = cz / n - 0.1;
      this.occluder.geometry.attributes.position.needsUpdate = true;
      this.occluder.geometry.computeVertexNormals();
      this.occluder.visible = true;
    } else {
      this.occluder.visible = false;
    }
  }

  render() { this.renderer.render(this.scene, this.camera); }

  clear() { this.renderer.clear(); }

  /**
   * Front / three-quarter / side / top of the current model on one transparent plate.
   * This is the "spec sheet" — it comes off the actual 3D model, not the flat photo.
   */
  contactSheet(px = 320) {
    if (!this.glasses) return null;
    const views = [
      { label: 'FRONT', rot: [0, 0, 0] },
      { label: '3/4', rot: [-0.15, -0.6, 0] },
      { label: 'SIDE', rot: [0, -Math.PI / 2, 0] },
      { label: 'TOP', rot: [-Math.PI / 2, 0, 0] },
    ];
    const out = document.createElement('canvas');
    out.width = px * views.length; out.height = px + 28;
    const octx = out.getContext('2d');
    octx.fillStyle = '#0b0b0c'; octx.fillRect(0, 0, out.width, out.height);

    const rt = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    rt.setSize(px, px, false);
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 1.5));
    const l = new THREE.DirectionalLight(0xffffff, 1.5); l.position.set(1, 1, 2); scene.add(l);
    const cam = new THREE.PerspectiveCamera(35, 1, 0.1, 100); cam.position.set(0, 0, 3.4);
    const model = this.glasses.clone(true);
    model.scale.setScalar(2.2); model.position.set(0, 0, 0);
    scene.add(model);

    views.forEach((v, i) => {
      model.rotation.set(...v.rot);
      rt.render(scene, cam);
      octx.drawImage(rt.domElement, i * px, 14, px, px);
      octx.fillStyle = '#e8ff45'; octx.font = '10px ui-monospace, monospace';
      octx.fillText(v.label, i * px + 10, out.height - 8);
    });
    rt.dispose();
    return out;
  }

  dispose() {
    if (this.glasses) disposeTree(this.glasses);
    this.occluder.geometry.dispose();
    this.renderer.dispose();
  }
}

function disposeTree(obj) {
  obj.traverse(o => {
    o.geometry?.dispose?.();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
      m.map?.dispose?.(); m.dispose?.();
    });
  });
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** '#rrggbb' or '#rrggbbaa' -> { color: THREE.Color, alpha: 0..1 }. */
function parseRGBA(hex) {
  const h = (hex || '#000000').replace('#', '');
  const rgb = h.slice(0, 6).padEnd(6, '0');
  const alpha = h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 0.15;
  return { color: new THREE.Color('#' + rgb), alpha };
}
