// The tracked 3D layer: takes a GlassesAsset, builds the extruded model, and places
// it on the face. Placement is screen-anchored (eye-corner midpoint, eye span, roll)
// with yaw/pitch from the landmarks rotating the real geometry; a face-oval depth
// mask hides whatever swings behind the head.

import * as THREE from 'three';
import { FACE_OVAL, ovalFanIndex } from './faceMesh.js';
import { buildGlassesFromAsset, studioEnvironment } from './glassesModel.js';

export { eulerFromLandmarks } from './frame.js';

const CAM_FOV = 40;
const CAM_DIST = 6;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export class Glasses3DLayer {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(CAM_FOV, 1, 0.1, 100);
    this.camera.position.set(0, 0, CAM_DIST);
    this.camera.lookAt(0, 0, 0);

    // the old rig (1.4 + 1.6 + a blue rim) blew out the frame texture and put a blue
    // cast on everything — an olive lens came out grey-blue. Keep it near 1.0 total.
    this.scene.environment = studioEnvironment(this.renderer);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 1.05); key.position.set(1, 1, 2);
    const rimL = new THREE.DirectionalLight(0xd8e2f0, 0.22); rimL.position.set(-1, 0.5, -1);
    this.scene.add(key, rimL);

    // one slot per face in shot — a pivot with its own copy of the frame, and its own
    // depth-only head so each pair is hidden by its own wearer
    this.slots = [];
    this.glasses = null;
    this._asset = null;
    this._opts = {};

    this.w = this.h = 1;
  }

  _makeSlot() {
    const pivot = new THREE.Group();
    this.scene.add(pivot);
    const occluder = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ colorWrite: false }));
    occluder.renderOrder = -1;
    const occ = new Float32Array(469 * 3);
    occluder.geometry.setAttribute('position', new THREE.BufferAttribute(occ, 3));
    occluder.geometry.setIndex(ovalFanIndex(468));
    this.scene.add(occluder);
    const slot = { pivot, occluder, occ, glasses: null };
    this.slots.push(slot);
    return slot;
  }

  setGlasses({ asset, opts }) {
    for (const s of this.slots) {
      if (s.glasses) { s.pivot.remove(s.glasses); disposeTree(s.glasses); s.glasses = null; }
    }
    this._asset = asset;
    this._opts = { ...opts };
    this.glasses = buildGlassesFromAsset(asset, opts);      // the original, shared materials
    const slot = this.slots[0] || this._makeSlot();
    slot.glasses = this.glasses;
    slot.pivot.add(this.glasses);
  }

  /** Everyone in shot wears it. Slots are grown once and reused. */
  updateAll(faces, fit, opts, worn) {
    if (!this.glasses) return;
    faces.forEach((f, i) => {
      const slot = this.slots[i] || this._makeSlot();
      if (!slot.glasses) {                       // clones share materials, so colour follows
        slot.glasses = this.glasses.clone(true);
        slot.pivot.add(slot.glasses);
      }
      this._updateSlot(slot, f.pose, f.euler, fit, worn, f.lm);
    });
    for (let i = faces.length; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (s.glasses) s.glasses.visible = false;
      s.occluder.visible = false;
    }
  }

  setColors(opts) {
    if (!this.glasses) return;
    const u = this.glasses.userData;
    if (opts.frameColor) u.frameMat.color.set(opts.frameColor);
    if (opts.lensColor) u.lensMat.color.set(opts.lensColor.slice(0, 7));
    if (opts.lensOpacity != null) u.lensMat.opacity = clamp(opts.lensOpacity, 0.02, 0.7);
    if (opts.frameOpacity != null) {
      u.frameMat.opacity = clamp(opts.frameOpacity, 0.2, 1);
      u.frameMat.transparent = opts.frameOpacity < 1;
      u.frameMat.needsUpdate = true;
    }
    this._opts = { ...this._opts, ...opts };
  }

  resize(w, h) {
    this.w = w; this.h = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _unitPerPx() {
    return (2 * CAM_DIST * Math.tan((CAM_FOV * Math.PI / 180) / 2)) / this.h;
  }

  /** pose px · euler rad · fit {w,h,x,y,scale,r} · opts · worn 0..1 · landmarks (mirrored) */
  update(pose, euler, fit, opts, worn, landmarks) {
    if (!this.glasses) return;
    this._updateSlot(this.slots[0], pose, euler, fit, worn, landmarks);
  }

  _updateSlot(slot, pose, euler, fit, worn, landmarks) {
    const glasses = slot?.glasses;
    if (!glasses) return;

    const upp = this._unitPerPx();
    const spanRatio = this._asset?.placement?.spanRatio ?? 1.55;
    const targetW = pose.eyeSpan * spanRatio * (fit.w ?? 1) * (fit.scale ?? 1) * upp;
    const base = targetW / 1.0;                       // model built ~1 unit wide
    glasses.scale.set(base, base * (fit.h ?? 1), base);

    const wx = (pose.cx - this.w / 2) * upp + pose.eyeSpan * (fit.x ?? 0) * upp;
    const wy = -(pose.cy - this.h / 2) * upp;
    const yRatio = 0.02 + (fit.y ?? 0);              // procedural asset centres on the eye line
    const forward = pose.eyeSpan * upp * 0.16;
    slot.pivot.position.set(wx, wy - yRatio * pose.eyeSpan * upp, forward);

    const ease = worn;
    slot.pivot.rotation.set(
      (euler.pitch || 0) * ease,
      (euler.yaw || 0) * ease,
      -((pose.angle ?? 0) + (fit.r ?? 0) * Math.PI / 180) * ease,
    );
    glasses.visible = ease > 0.02;
    glasses.scale.multiplyScalar(0.6 + 0.4 * ease);
    glasses.position.z = (1 - ease) * 0.6;

    if (landmarks && landmarks.length >= 468) {
      const depth = pose.eyeSpan * upp * 2.2;
      const toW = q => [(q.x * this.w - this.w / 2) * upp, -(q.y * this.h - this.h / 2) * upp, -q.z * depth];
      for (let i = 0; i < 468; i++) {
        const [x, y, z] = toW(landmarks[i]);
        slot.occ[i * 3] = x; slot.occ[i * 3 + 1] = y; slot.occ[i * 3 + 2] = z;
      }
      let cx = 0, cy = 0, cz = 0;
      for (const k of FACE_OVAL) { const [x, y, z] = toW(landmarks[k]); cx += x; cy += y; cz += z; }
      const n = FACE_OVAL.length;
      slot.occ[468 * 3] = cx / n; slot.occ[468 * 3 + 1] = cy / n; slot.occ[468 * 3 + 2] = cz / n - 0.1;
      slot.occluder.geometry.attributes.position.needsUpdate = true;
      slot.occluder.geometry.computeVertexNormals();
      slot.occluder.visible = true;
    } else {
      slot.occluder.visible = false;
    }
  }

  render() { this.renderer.render(this.scene, this.camera); }
  clear() { this.renderer.clear(); }

  /** front / 3-4 / side / top of the built model on one plate. */
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
    scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const l = new THREE.DirectionalLight(0xffffff, 1.05); l.position.set(1, 1, 2); scene.add(l);
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
    for (const s of this.slots) {
      if (s.glasses) disposeTree(s.glasses);
      s.occluder.geometry.dispose();
    }
    this.slots.length = 0;
    this.renderer.dispose();
  }
}

function disposeTree(obj) {
  obj.traverse(o => {
    o.geometry?.dispose?.();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { m.map?.dispose?.(); m.dispose?.(); });
  });
}
